# ScienceEvolve software-development workflow for Science Bench

This adapter runs the upstream `example/02-software-development/workflow.json`
through the real ScienceEvolve main SDK and its bundled pi harness. The coding,
testing and exceptional recovery roles, routes and completion policy are retained.
Only model/harness bindings and generic Science Bench workspace instructions change.

`scienceevolve-bench` is the executable entry. It reads `instruction.md` by default;
`-p/--prompt` accepts prompt text and `--prompt-file` accepts a path. Optional
`--model` defaults to `DeepSeek-V4.1-Flash-1017`; `--context-window` defaults to
131072. Required parameters are declared in `harness.json`; there is no local
registration dependency and no provider credential in the submission.

The assembled submission includes a Linux x86_64 Node 24 runtime, the compiled
SDK and production npm dependencies as ordinary files. It runs offline without
installation. `ipc.cjs` maps the virtual provider origin `https://10.255.255.1`
exclusively to the framework's `/run/model.sock`. That address is only an
in-process alias; no IP connection to it is attempted. The SDK's local HTTP/MCP
services run inside the existing isolated network namespace. The official
namespace/seccomp policy stays intact and external networking remains blocked.

Runtime state lives in per-trial `/tmp`; logs and snapshots go to `outputs/`.
Scientific repairs must be produced under `source/` during the current run.
No task-specific answers, patches or development repairs are bundled.

Build the SDK on an online Linux preparation machine with Node 24 on PATH:

```sh
npm ci
npm run build
npm prune --omit=dev --ignore-scripts --no-audit --no-fund
python3 adapters/science-bench-admission/assemble.py --sdk-root "$PWD" \
  --node /path/to/node-v24-linux-x64/bin/node --output /path/to/handoff/20260002/harness
```

The normal build happens before dependency pruning. `assemble.py` copies the
exact workflow from this repository and preserves required executable modes.
Symlinks from npm are resolved into ordinary files; npm command shims and the
workspace self-link are excluded because runtime imports use explicit SDK paths.

After assembling the portable submission, validate and run from the official exam:

```sh
python3 tools/check_harness_submission.py /path/to/handoff/20260002/harness
python3 -m native_exam run --task 020 --grading full --timeout 120 \
  --harness /path/to/handoff/20260002/harness --provider-file /private/provider.json
python3 -m native_exam batch --group all --grading full --timeout 600 --jobs 0 \
  --harness /path/to/handoff/20260002/harness --provider-file /private/provider.json
```

The real provider key belongs only in the host's private provider file. The
exam's fixed destination relay replaces the SDK's placeholder authentication.
