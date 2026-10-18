# ScienceEvolve SDK acceptance

The implementation payload is frozen at
`05d84e8870f0926157883f7a7b49279e53c623df` on
`refactor/scienceevolve-sdk`. The original publishing commit is
`4160a2cf0259b2a1ed9dc4eb36bc0484d2527a42`; its twelve pre-existing documentation
changes are separately preserved by `ff776f1` and
[the baseline preservation check](baseline-preservation.json).

The final source archive is made from the subsequent report-freeze commit.
Its exact commit, SHA-256, file/mode inventory, clean installation/build and
Git-independent scans belong to the detached `release-manifest.json` delivered
beside the artifacts. [The machine acceptance contract](acceptance.json) requires
that receipt to report success before final source-delivery acceptance. Keeping
the archive's digest in its detached receipt avoids a self-referential payload.

| Goal acceptance condition | Evidence |
| --- | --- |
| Complete delivery coverage | All 1,996 original paths and 78 executable modes are checked by the [source-delivery inventory](source-delivery-inventory.json) and its CI gate; the final receipt checks every archive member and all generated files. [Binary review](binary-inventory.json) classifies 93 original assets, including visual inspection of both authored diagrams. |
| Every original naming candidate resolved | [The candidate ledger](candidate-resolutions.json) closes 1,277 files and 3,459 occurrences. [The environment audit](ENVIRONMENT-AUDIT.md) closes 90 symbols and 1,678 references; direct name collisions and unresolved references are zero. |
| Current public names and generated content agree | [The execution record](EXECUTION.md) defines the naming map. Runtime, source/path/generated/package gates, protocol probes and installed CLI/API checks protect the main and legacy interfaces. |
| References and resources remain available | [The link audit](link-audit.json) separates inherited third-party gaps from rename failures. [Vendor delivery](vendor-delivery-audit.json) checks 836 source pins across 12 manifests; [preservation](third-party-preservation.json) verifies 838 exact original files and committed modes. |
| Sources and generation remain provable | [Candidate provenance](CANDIDATE-AUDIT.md) and [Linux validation](linux-sdk-validation.md) verify 247 runtime files, exact fixed-source regeneration, derived executable digests and 282 reversible semantic edits in 18 workflows. Every original semantic digest remains unchanged. |
| Required executable checks pass | [Linux validation](linux-sdk-validation.md) records the complete immutable-checkpoint SDK run, type check, build, 69 Python tests, 23 environment probes, 11 original research tests and full installed-package smoke. [Windows validation](windows-sdk-validation.md) records the completed-run union and unchanged retries honestly. |
| Exact preserved evidence and regression protection exist | The source, static-string and packed-artifact gate uses 124 exact selectors. New residues, changed counts and stale selectors fail. CI also runs delivery, generation, semantic, environment and research checks. |
| Reports match actual deliverables | [Package acceptance](package-audit.json), [source acceptance](source-archive-audit.json) and the detached final receipt identify their actual snapshots and verification scopes. Earlier failures and earlier proof artifacts remain separately identified. |

The Linux SDK result is 2,790 passes, ten existing installed-native opt-in skips
and zero failures across 114 files. The Windows completed-run union is 2,468
passes, 332 explicit platform/native-capability skips and zero unresolved failures
across the same 2,800 cases. The Windows result includes targeted unchanged retries
and is not an atomic single-invocation claim. Skips are listed individually in
the respective machine reports. No macOS run or paid-model/scientific benchmark
acceptance is claimed.

The canonical npm artifact is `scienceevolve-sdk-0.1.1.tgz`, 33,245,469 bytes,
SHA-256 `bba320502ce3963c43361fcd0bbc945ed5804f6058f42a88d5b1962cb26cdc9d`.
It is retained in the external delivery directory
`D:/openfars/.cache/scienceevolve-refactor/artifacts`. Its actual 1,314-file payload
and independent installation are verified separately from the source archive.

Configuration and old-state boundaries are documented in
[the shipped migration guide](../../sdk/docs/naming-migration.md). Trials use
isolated data; original user runtime state is preserved. The main CLI still
requires an explicit data directory; the legacy environment/default directory
contract remains distinct.

The SDK retains `private: true`. Namespace ownership, remote publication targets,
the publishing account and that release setting require resolution by an authorized
release process. This task does not push, merge, rename remote repositories or
publish to npm. Remote CI has not been run; its checked-in commands were exercised
locally on the recorded platforms.
