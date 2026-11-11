"""Pure fake-process controls for the outer replay evidence lifecycle."""

import importlib.util
import json
import signal
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location(
    "capture", Path(__file__).with_name("capture_native_replay.py")
)
capture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture)


class CaptureLifecycle(unittest.TestCase):
    def execute(self, configure):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "input").mkdir()
            (root / "node").write_text("fake runtime, never executed")
            handlers = {}

            def register(number, handler):
                handlers[number] = handler
                return signal.SIG_DFL

            child = Mock(pid=123, poll=Mock(return_value=None))
            launch = Mock(return_value=child)
            terminate = Mock()
            configure(child, handlers, launch, terminate)
            argv = ["capture", "--replay", str(root / "input"), "--output", str(root / "output"),
                    "--capture", str(root / "capture"), "--identity", str(root / "node")]
            with patch.object(capture.sys, "argv", argv), \
                    patch.object(capture.Path, "cwd", return_value=root), \
                    patch.object(capture.shutil, "which", return_value=str(root / "node")), \
                    patch.object(capture.subprocess, "check_output", return_value="fake-version"), \
                    patch.object(capture.subprocess, "Popen", launch), \
                    patch.object(capture.os, "killpg", terminate), \
                    patch.object(capture.signal, "signal", side_effect=register), \
                    patch("builtins.print"):
                status = capture.main()
            result = json.loads((root / "capture/execution-result.json").read_text())
            self.assertTrue((root / "capture/stdout.log").is_file())
            self.assertTrue((root / "capture/stderr.log").is_file())
            self.assertTrue(result["identitiesUnchanged"])
            return status, result, terminate

    def test_normal_completion(self):
        def configure(child, *_):
            child.wait.return_value = 0
        status, result, terminate = self.execute(configure)
        self.assertEqual((status, result["observedExitCode"]), (0, 0))
        terminate.assert_not_called()

    def test_child_exit_races_with_cancellation(self):
        def configure(child, handlers, _launch, terminate):
            child.wait.side_effect = [capture.ReplayCancelled(signal.SIGTERM), -15]
            terminate.side_effect = ProcessLookupError("already exited")
        status, result, _ = self.execute(configure)
        self.assertEqual((status, result["observedSignal"]), (1, 15))
        self.assertEqual(result["cleanupErrors"], [])

    def test_repeated_parent_signals_do_not_skip_finalization(self):
        def configure(child, handlers, _launch, terminate):
            def first_wait(*_args, **_kwargs):
                handlers[signal.SIGTERM](signal.SIGTERM, None)
            def wait(*args, **kwargs):
                if not kwargs:
                    first_wait()
                return -15
            child.wait.side_effect = wait
            terminate.side_effect = lambda *_: handlers[signal.SIGINT](signal.SIGINT, None)
        status, result, _ = self.execute(configure)
        self.assertEqual(status, 1)
        self.assertEqual([item["signal"] for item in result["wrapperSignals"]],
                         [signal.SIGTERM, signal.SIGINT])

    def test_termination_escalates_with_bounded_wait(self):
        def configure(child, *_):
            child.wait.side_effect = [capture.ReplayCancelled(signal.SIGTERM),
                                     subprocess.TimeoutExpired("fake", 5), -9]
        status, result, terminate = self.execute(configure)
        self.assertEqual((status, result["observedSignal"]), (1, 9))
        self.assertEqual([call.args[1] for call in terminate.call_args_list],
                         [signal.SIGTERM, signal.SIGKILL])
        self.assertEqual(len(result["cleanupErrors"]), 1)

    def test_launch_failure_still_publishes_outer_record(self):
        def configure(_child, _handlers, launch, _terminate):
            launch.side_effect = OSError("fake launch failure")
        status, result, terminate = self.execute(configure)
        self.assertEqual(status, 1)
        self.assertIsNone(result["observedReturnCode"])
        self.assertIn("fake launch failure", result["launchOrWaitFailure"])
        terminate.assert_not_called()

    def test_cleanup_failure_retains_unavailable_return_code(self):
        def configure(child, _handlers, _launch, terminate):
            child.wait.side_effect = [capture.ReplayCancelled(signal.SIGTERM),
                                     OSError("fake wait failure"), OSError("fake wait failure")]
            terminate.side_effect = PermissionError("fake termination failure")
        status, result, _ = self.execute(configure)
        self.assertEqual(status, 1)
        self.assertIsNone(result["observedReturnCode"])
        self.assertFalse(result["childTerminationConfirmed"])
        self.assertEqual(len(result["cleanupErrors"]), 4)


if __name__ == "__main__":
    unittest.main()
