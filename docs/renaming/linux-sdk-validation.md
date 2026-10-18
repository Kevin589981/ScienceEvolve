# Linux SDK validation

Checkpoint `05d84e8870f0926157883f7a7b49279e53c623df` passed the complete Linux acceptance run in a fresh full-history clone. The isolated official-base image used Node v24.22.0, Python 3.12.15, npm 11.19.1 and Git 2.39.5. Fresh Linux dependencies were installed with offline npm ci; Windows node_modules were not shared. Docker used --init, a read-only root filesystem and executable temporary storage.

| Check | Result |
| --- | --- |
| Original source delivery | 1,996 paths, 78 original executable Git modes and 836 pins across 12 manifests passed |
| Main runtime | 247 files passed integrity and fixed-source regeneration |
| Workflow semantic provenance | 18 workflows and 282 reversible edits passed; every original semantic hash remains unchanged |
| Type checking and build | Passed |
| Complete SDK suite | 2790 passed, 0 failed; 10 existing installed-native opt-in cases skipped, across 114 files |
| Python example protocols | 69 passed; no failures, errors or skips |
| Environment consumers | 23 probes passed; 90 original symbols and 1,678 occurrences audited with no collisions or unresolved references |
| Original research Node tests | 11 passed; no failures or skips |
| Isolated installed-package smoke | Passed, including main/legacy APIs, actual CLI, SQLite/MCP/Git, examples and SIGINT/SIGTERM recovery |

The actual Linux tarball is `D:/openfars/.cache/scienceevolve-refactor/linux-results/scienceevolve-sdk-linux-05d84e88.tgz` (33245469 bytes), SHA-256 `bba320502ce3963c43361fcd0bbc945ed5804f6058f42a88d5b1962cb26cdc9d`. Its package.json and package branding report are retained with the smoke log. The delivered-package scan inspected 1314 files and reported zero unexplained matches or stale exceptions. The package retains its current private flag; this run proves local installation and behavior, not a registry publication.

[The machine report](linux-sdk-validation.json) records every command, duration, optional native skip, artifact and log path. [The Python report](python-linux-validation.json) records the 474-file input snapshot; [the delivery audit](vendor-delivery-audit.json) preserves the initial missing-file observation. [The validation environment](../../scripts/validation/README.md) is reproducible from official digest-pinned bases and the complete pinned Python dependency lock.

Earlier failures remain evidence. Checkpoint d99427d7 had 23 failures: sixteen semantic tests lacked the exact naming overlay, one staged RRsi test exposed two ignored required data files, one TODO test contradicted pre-existing incomplete design files, and five process/lease/deadline cases needed environment investigation. Four unchanged cases passed after the recorded host sleep; a controlled no-init/--init comparison showed an orphaned Node zombie without init and successful reaping with init. The complete canonical run then passed with the original assertions, deadlines and default four-worker configuration. No tests were removed to obtain the result.

The ten unenabled tests require real installed Hermes (four), Pi (four), Codex (one) and Claude (one). Their exact names appear in the machine report. These offline checks do not establish paid-model results, external research service availability, scientific benchmark quality or macOS support.
