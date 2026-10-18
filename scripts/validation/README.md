# CI validation

## Runtime and example provenance

The SDK CI runs from a shallow checkout of this repository. It does not need
the former repository or its Git history:

```sh
node sdk/scripts/sync-main-runtime.mjs --verify-generation
node sdk/scripts/check-example-semantics.mjs
```

Runtime regeneration reads `sdk/tests/fixtures/main-runtime-upstream.json.gz`,
a snapshot of the original Git blobs used by the runtime manifest. Every
blob is checked against that manifest's original SHA-256 before replaying
the declared fixes, naming edits, test adaptations and executable pins.
The generated metadata and all 274 output files must match exactly. The
snapshot is a test fixture and is excluded from the npm package; its
historical names are original provenance, not public SDK identifiers.

To refresh the snapshot after an intentional runtime import, use a checkout
containing the pinned upstream commits:

```sh
node sdk/scripts/runtime-source-snapshot.mjs --source /path/to/upstream
node sdk/scripts/sync-main-runtime.mjs --source /path/to/upstream --verify-generation
node sdk/scripts/sync-main-runtime.mjs --verify-generation
```

Example verification reverses the saved naming edits, checks the recovered
semantic bytes against the immutable migration hashes, then replays the
current naming rules and compares the complete proof. Regenerating that
proof still requires the original sources:

```sh
node sdk/scripts/check-example-semantics.mjs --source /path/to/historical-checkout --write
```

## Linux offline validation

The Dockerfile uses official Python 3.12 and Node 24 images pinned by digest.
`python-requirements.lock.txt` pins the complete dependency closure needed by
the offline example protocol suite. It includes the numerical libraries used
by FunSearch, the real Biomni A1 protocol dependencies, and PDF parsing for
the local AgentRxiv service test.

Build from the repository root:

```sh
docker build -t scienceevolve-validation -f scripts/validation/Dockerfile scripts/validation
```

Run every Python example test with the checkout mounted read only:

```sh
docker run --rm --init --network none --read-only \
  --tmpfs /tmp:exec,mode=1777 \
  --mount "type=bind,source=$PWD,target=/work,readonly" \
  scienceevolve-validation
```

The init process reaps orphaned subprocesses so SDK lifecycle assertions observe real process termination. The executable temporary mount is required because the Biomni test executes
a real temporary Bash script. Network access is disabled during tests; the
HTTP service fixture uses only the container's loopback interface. The runner
fails when any test fails or is skipped, so missing dependencies cannot
silently reduce coverage.

To retain the machine report, create an output directory and mount it at
`/results`, then append these arguments:

```sh
python -B /opt/validation/run-python-tests.py --root /work --report /results/python-linux-validation.json
```

The image also contains Node and npm for SDK validation. Install Linux npm
dependencies into a separate writable container directory or volume. Do not
mount a Windows `node_modules` directory into a Linux validation run.
The image exposes its Python 3.12 interpreter at `/usr/bin/python3`, the SDK's
default POSIX helper path, as well as the official image's `/usr/local/bin` path.

These tests verify local algorithms, provenance, Git operations, state
transitions, Python/Bash execution, and local HTTP/PDF IO. They do not execute
paid models, external scientific services, or scientific benchmarks.
