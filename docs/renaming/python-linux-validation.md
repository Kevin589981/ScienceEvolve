# Python example Linux validation

Checkpoint `05d84e8870f0926157883f7a7b49279e53c623df` passed all 69 offline example tests in a fresh complete-history Linux clone: zero failures, errors or skipped tests, in 11.066 seconds. The latest 474-file input snapshot is `dbe8f4ca751cb256252d97a77ac65762ec42918ca0c4c148d45d1dc998d9d6c1`; it records Python/JSON sources plus LICENSE and NOTICE files, including the final workflow contract documents. Separate complete pin checks verify both required RRsi data files delivered through Git.

The image is `sha256:9d7320de2bb373ce097ea5bc3c2b095ef05412fb95979c00d88e20dcd35aca7e`, using official digest-pinned Python 3.12 and Node 24 bases, Git, and the complete 60-package pinned Python dependency closure. Its actual build passed pip check. The checkout and root filesystem were read only, networking was disabled, Docker used --init, and temporary files used /tmp:exec,mode=1777. The SDK helper interpreter is available at /usr/bin/python3.

[The machine report](python-linux-validation.json) contains dependency versions, each test and the SHA-256 input list. The full log is `D:/openfars/.cache/scienceevolve-refactor/linux-results/python-linux-canonical.log`. Reproduce it with [the Dockerfile and commands](../../scripts/validation/README.md). The strict runner fails on any skipped test.

The suite performs real local Git operations and recovery, pinned FunSearch algorithms, Biomni Python/Bash execution, AgentRxiv local HTTP/PDF IO and pinned-source integrity checks. [Separate Linux SDK acceptance](linux-sdk-validation.md) passed the complete SDK suite, environment/research probes, build and installed-package smoke. Python protocol results alone do not imply those checks.

Earlier evidence remains recorded: the Windows baseline lacked POSIX locking and Python dependencies; original checkout CRLF conversion changed pinned bytes while the original Git blobs matched their hashes; a noexec temporary mount blocked the real Bash step; C-drive exhaustion interrupted the first image export. A Docker CLI start error claimed a missing launcher, while later filesystem/version/registry checks proved it existed; API recovery and successful executions followed. Prior host-checkout 69-test results remain historical, with the fresh-clone snapshot above serving as canonical evidence.

These tests do not execute paid models, external scientific services or scientific benchmarks, and do not establish macOS support.
