"""Capture one reviewed frozen-input native replay without reusing output paths.

Run from the decoder root, which the replay argv is relative to.
"""

import argparse
import hashlib
import json
import os
import platform
import resource
import shutil
import signal
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


def utc():
    return datetime.now(timezone.utc).isoformat()


def identity(path):
    path = Path(path).resolve(strict=True)
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return {"path": str(path), "bytes": path.stat().st_size, "sha256": digest.hexdigest()}


def write_new(path, value):
    with path.open("x") as stream:
        json.dump(value, stream, indent=2)
        stream.write("\n")


def overlaps(left, right):
    return left == right or left in right.parents or right in left.parents


class ReplayCancelled(BaseException):
    pass


def stop_child(child):
    """Bound cleanup and retain termination races instead of losing final metadata."""
    errors = []
    returncode = None
    if child is None:
        return returncode, errors
    try:
        returncode = child.poll()
    except Exception as error:
        errors.append(f"poll: {type(error).__name__}: {error}")
    if returncode is not None:
        return returncode, errors
    for signum in [signal.SIGTERM, signal.SIGKILL]:
        try:
            os.killpg(child.pid, signum)
        except ProcessLookupError:
            pass
        except Exception as error:
            errors.append(f"killpg({signum}): {type(error).__name__}: {error}")
        try:
            returncode = child.wait(timeout=5)
            break
        except Exception as error:
            errors.append(f"wait({signum}): {type(error).__name__}: {error}")
    return returncode, errors


def optional_identity(path):
    try:
        return identity(path) if path.is_file() else None
    except Exception as error:
        return {"error": f"{type(error).__name__}: {error}"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--replay", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--capture", required=True)
    parser.add_argument("--identity", action="append", required=True)
    args = parser.parse_args()
    cwd = Path.cwd().resolve()
    replay = Path(args.replay).resolve(strict=True)
    output = Path(args.output).resolve()
    capture = Path(args.capture).resolve()
    if not replay.is_dir() or overlaps(replay, output) or overlaps(replay, capture):
        raise ValueError("Replay input must be a directory disjoint from output and capture")
    if overlaps(output, capture):
        raise ValueError("Output and capture must be disjoint")
    if Path(args.output).exists() or Path(args.output).is_symlink():
        raise FileExistsError("Output must be physically absent; failed attempts cannot be reused")
    if Path(args.capture).exists() or Path(args.capture).is_symlink():
        raise FileExistsError("Capture must be physically absent")
    node = Path(shutil.which("node") or "").resolve(strict=True)
    before = [identity(path) for path in args.identity]
    runtime = identity(node)
    version = subprocess.check_output([str(node), "--version"], text=True).strip()
    argv = [str(node), "scripts/qualify-jsconfuser-vm/qualify.mjs", "--replay", str(replay),
            "--replay-mode", "native", "--output", str(output)]
    capture.mkdir(parents=True, exist_ok=False)
    start = {
        "argv": argv, "cwd": str(cwd), "utcStart": utc(),
        "host": platform.node(),
        "os": {"system": platform.system(), "release": platform.release(), "version": platform.version()},
        "architecture": platform.machine(),
        "runtime": runtime, "runtimeVersion": version, "python": identity(sys.executable),
        "identitiesBefore": before,
        "environment": {key: os.environ.get(key) for key in
                        ["PATH", "NODE_OPTIONS", "JAVA_HOME", "LANG", "LC_ALL", "TZ"]},
        "execution": "Serial reviewed core replay; child timeouts unchanged; no outer timeout",
    }
    write_new(capture / "execution-start.json", start)
    child = None
    interrupted = None
    failure = None
    returncode = None
    cleanup_errors = []
    signals = []
    finalizing = False

    def cancel(signum, _frame):
        signals.append({"signal": signum, "utc": utc()})
        if not finalizing and len(signals) == 1:
            raise ReplayCancelled(signum)

    previous_handlers = {number: signal.signal(number, cancel)
                         for number in [signal.SIGINT, signal.SIGTERM, signal.SIGHUP]}
    try:
        with (capture / "stdout.log").open("xb") as stdout, (capture / "stderr.log").open("xb") as stderr:
            child = subprocess.Popen(argv, cwd=cwd, stdout=stdout, stderr=stderr, start_new_session=True)
            returncode = child.wait()
    except ReplayCancelled as error:
        interrupted = f"Signal {error.args[0]}"
    except KeyboardInterrupt:
        interrupted = "KeyboardInterrupt"
    except Exception as error:
        failure = f"{type(error).__name__}: {error}"
    except BaseException as error:
        failure = f"{type(error).__name__}: {error}"
    finally:
        finalizing = True
        if returncode is None:
            returncode, cleanup_errors = stop_child(child)
        after = []
        identity_failure = None
        try:
            after = [identity(path) for path in args.identity]
        except Exception as error:
            identity_failure = f"{type(error).__name__}: {error}"
        inventory = []
        inventory_failure = None
        try:
            if output.is_dir():
                for path in sorted(output.rglob("*")):
                    if path.is_symlink():
                        inventory.append({"path": str(path.relative_to(output)), "type": "symlink",
                                          "target": os.readlink(path)})
                    elif path.is_file():
                        inventory.append({"path": str(path.relative_to(output)), "bytes": path.stat().st_size})
        except Exception as error:
            inventory_failure = f"{type(error).__name__}: {error}"
        result = {
            "utcEnd": utc(), "observedReturnCode": returncode,
            "observedExitCode": returncode if returncode is not None and returncode >= 0 else None,
            "observedSignal": -returncode if returncode is not None and returncode < 0 else None,
            "interruption": interrupted, "wrapperSignals": signals,
            "launchOrWaitFailure": failure, "cleanupErrors": cleanup_errors,
            "childTerminationConfirmed": returncode is not None if child is not None else None,
            "outerTimeout": None, "oom": "Not independently classified; inspect retained stderr and signal",
            "identitiesAfter": after, "identitiesUnchanged": before == after and identity_failure is None,
            "identityReadFailure": identity_failure,
            "publication": {"output": str(output), "members": inventory, "inventoryFailure": inventory_failure},
            "childPeakRssPlatformUnits": resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss,
            "stdout": optional_identity(capture / "stdout.log"),
            "stderr": optional_identity(capture / "stderr.log"),
        }
        write_new(capture / "execution-result.json", result)
        for number, handler in previous_handlers.items():
            signal.signal(number, handler)
        print(json.dumps({"capture": str(capture), "observedReturnCode": returncode,
                          "identitiesUnchanged": result["identitiesUnchanged"]}))
        if interrupted or signals or failure or cleanup_errors or inventory_failure or not result["identitiesUnchanged"]:
            status = 1
        else:
            status = returncode if returncode is not None and returncode >= 0 else 1
    return status


if __name__ == "__main__":
    sys.exit(main())
