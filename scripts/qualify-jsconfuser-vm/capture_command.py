"""Retain a bounded VM validation command's actual completion and exact streams."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
from datetime import datetime, timezone


def utc():
    return datetime.now(timezone.utc).isoformat()


def identity(filename):
    path = Path(filename).resolve(strict=True)
    data = path.read_bytes()
    return {"path": str(path), "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--capture", required=True)
    parser.add_argument("--cwd", required=True)
    parser.add_argument("--timeout", type=int, required=True)
    parser.add_argument("--identity", action="append", default=[])
    parser.add_argument("argv", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    argv = args.argv[1:] if args.argv[:1] == ["--"] else args.argv
    if not argv or args.timeout <= 0:
        parser.error("A command and positive timeout are required")
    capture = Path(args.capture).resolve()
    capture.mkdir(parents=True, exist_ok=False)
    before = [identity(path) for path in args.identity]
    start = {"argv": argv, "cwd": str(Path(args.cwd).resolve()), "startedAt": utc(),
             "timeoutSeconds": args.timeout, "identities": before}
    (capture / "start.json").write_text(json.dumps(start, indent=2) + "\n")
    child = None
    timed_out = False
    failure = None
    try:
        with (capture / "stdout.log").open("xb") as out, (capture / "stderr.log").open("xb") as err:
            child = subprocess.Popen(argv, cwd=args.cwd, stdout=out, stderr=err, start_new_session=True)
            try:
                child.wait(timeout=args.timeout)
            except subprocess.TimeoutExpired:
                timed_out = True
    except BaseException as error:
        failure = f"{type(error).__name__}: {error}"
    finally:
        if child and child.poll() is None:
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            child.wait(timeout=10)
        after = [identity(path) for path in args.identity]
        code = child.returncode if child else None
        result = {"completedAt": utc(), "exitCode": code if code is not None and code >= 0 else None,
                  "signal": -code if code is not None and code < 0 else None, "timedOut": timed_out,
                  "failure": failure, "identitiesUnchanged": before == after,
                  "identitiesAfter": after, "stdout": identity(capture / "stdout.log"),
                  "stderr": identity(capture / "stderr.log")}
        (capture / "result.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result))
    if code != 0 or timed_out or failure or before != after:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
