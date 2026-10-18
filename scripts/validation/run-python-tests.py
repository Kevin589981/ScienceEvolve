"""Run offline example protocol tests and optionally retain machine evidence."""
import argparse
import datetime
import hashlib
import importlib.metadata
import json
from pathlib import Path
import platform
import subprocess
import sys
import time
import unittest


class RecordedResult(unittest.TextTestResult):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.successful = []

    def addSuccess(self, test):
        self.successful.append(test.id())
        super().addSuccess(test)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    root = args.root.resolve()
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    snapshot = []
    for source in sorted((root / "example").rglob("*")):
        if source.is_file() and (
            source.suffix in {".py", ".json"} or source.name in {"LICENSE", "NOTICE"}
        ):
            snapshot.append({
                "path": source.relative_to(root).as_posix(),
                "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
            })
    snapshot_sha = hashlib.sha256(json.dumps(
        snapshot, separators=(",", ":"), sort_keys=True
    ).encode()).hexdigest()
    suite = unittest.defaultTestLoader.discover(str(root / "example/tests"))
    timer = time.monotonic()
    result = unittest.TextTestRunner(verbosity=2, resultclass=RecordedResult).run(suite)
    report = {
        "schemaVersion": 1,
        "startedAt": started,
        "finishedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "elapsedSeconds": time.monotonic() - timer,
        "platform": platform.platform(),
        "python": sys.version,
        "git": subprocess.check_output(["git", "--version"], text=True).strip(),
        "node": subprocess.check_output(["node", "--version"], text=True).strip(),
        "npm": subprocess.check_output(["npm", "--version"], text=True).strip(),
        "sourceRoot": str(root),
        "sourceSnapshotSha256": snapshot_sha,
        "sourceSnapshotFileCount": len(snapshot),
        "sourceSnapshot": snapshot,
        "testsRun": result.testsRun,
        "successful": result.successful,
        "failures": [{"id": test.id(), "traceback": error} for test, error in result.failures],
        "errors": [{"id": test.id(), "traceback": error} for test, error in result.errors],
        "skipped": [{"id": test.id(), "reason": reason} for test, reason in result.skipped],
        "unexpectedSuccesses": [test.id() for test in result.unexpectedSuccesses],
        "wasSuccessful": result.wasSuccessful(),
        "dependencyVersions": dict(sorted((
            (distribution.metadata["Name"], distribution.version)
            for distribution in importlib.metadata.distributions()
        ))),
    }
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if result.skipped:
        print("Offline example validation requires all dependencies; skipped tests fail this gate.", file=sys.stderr)
    return 0 if result.testsRun and result.wasSuccessful() and not result.skipped else 1


if __name__ == "__main__":
    raise SystemExit(main())
