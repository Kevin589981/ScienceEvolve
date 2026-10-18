# ScienceEvolve naming refactor execution record

## Objective and baseline

Unify the SDK's product, package, CLI, environment, internal paths, authored Skills,
source, examples, documentation, tests and distributable artifacts under ScienceEvolve.
Existing main/legacy APIs and Harness functionality remain part of acceptance.

- Remote SDK branch verified on 2026-10-15: `origin/feat/sdk-only-v0.1.1`.
- Upstream SDK commit: `4160a2cf0259b2a1ed9dc4eb36bc0484d2527a42`.
- Implementation branch: `refactor/scienceevolve-sdk`.
- Existing changes to twelve delivery documentation files were copied from the
  publishing checkout and committed separately as `ff776f1`.
- Original working-copy patch and SHA-256 inventory are preserved outside the
  repository at `D:\openfars\.cache\scienceevolve-refactor\baseline-working-tree.*`.
- The source publishing checkout and its existing changes are preserved.
- Execution host: Windows, PowerShell 7.6.6, Node 24.20.0, Python 3.14.0.

## Naming contract

| Surface | Target |
| --- | --- |
| Product | ScienceEvolve |
| npm package | @scienceevolve/sdk |
| CLI / entry file | scienceevolve / scienceevolve.mjs |
| Workspace | scienceevolve-sdk-workspace |
| Environment prefix | SCIENCEEVOLVE_ |
| Internal directory | .scienceevolve |
| SDK authoring Skill | scienceevolve-sdk |
| Authored Skill prefix | scienceevolve- |
| PascalCase / camelCase | ScienceEvolve / scienceEvolve |

## Milestones and acceptance

- [x] Verify the remote SHA, preserve pre-existing changes, isolate implementation.
- [x] Record baseline integrity/type/example checks and occurrence inventory.
- [x] Rename authored content and paths; preserve third-party bytes and historical evidence.
- [x] Implement reversible runtime branding after upstream shared fixes.
- [x] Add content/path/generated/package branding gates and exact exceptions.
- [x] Verify runtime provenance, typecheck, SDK tests and Python example tests.
- [x] Build from clean generated directories, pack and install outside the checkout.
- [x] Validate CLI, public exports, environment propagation, workflows and lifecycle.
- [x] Review installed artifacts independently, review links/resources and platform limits.
- [x] Record coverage, exact residuals, npm artifact hashes and external publishing prerequisites.
- [x] Freeze source reports and establish the detached final source acceptance contract.

The source archive is created from the report-freeze commit after these documents
are committed. Its later installation, build, member/mode checks and independent
review must pass in the detached `release-manifest.json` beside the artifacts.
That receipt is the authority for post-freeze source acceptance; the frozen source
documents do not assert that the later run has already happened.

## Evidence policy

Every candidate must resolve to a change or a precise, justified preservation.
Historical commands, actual test outputs, upstream patch text and legal attribution
are evidence, not current usage instructions. Source hashes may not be invented or
drift verification weakened. A generated overlay must be reproducible and reversible.

The gate must reject new unexplained content/path hits and stale exceptions.
Binary resources receive explicit classification and project-owned visual review.
Source, generated directories, the packed archive and installed consumer are separate
verification surfaces. Unavailable platforms must be reported as untested.

## Iteration log

### 2026-10-15: baseline and implementation setup

- Existing runtime provenance check passed: 247 files, revision
  `48e82cedd993d67f2379c36fade8973db63c74e8+f3c0775e4f8b06de`.
- Runtime provenance and branding-gate work are delegated in the shared implementation
  checkout with disjoint file ownership. Baseline checks use the unchanged publishing
  checkout and place their logs outside it.
- Refactoring, tests and packaging are authorized locally. Publication, remote renames,
  pushes and merges remain outside this goal's completion criteria.

### First implementation and validation

- The initial pass changed 343 authored text files and renamed 15 path roots.
  The occurrence and path ledger is `baseline-inventory.json`.
- Broadly matching the old complete package name would also consume the method
  suffix in the ARIS Skill. The policy now distinguishes full-brand tokens from
  authored Skill prefixes and has a regression for that boundary.
- Fixed example sources suffered Windows checkout newline conversion before this
  refactor: 798 working files disagreed with their pins, while every original Git
  blob matched. Exact upstream Git bytes were restored and attributes now protect
  those paths. Expected source hashes were preserved.
- The two project diagrams were visually inspected and contain no brand text;
  93 actual non-text source assets retain explicit classification and hashes.
- Source provenance now checks 247 files. Generation and inverse transformation
  were compared against the real fixed upstream checkout, including all metadata.
- A full regression exposed a renamed executable's outdated source/compiled digest.
  The derived-pin overlay now proves those hashes using TypeScript 5.9.3 and LF,
  while its inverse still recovers the exact original source hash. Compiler output
  was checked byte for byte against the derived compiled digest.
- Type checking and the integrated build passed. Linux example tests passed all
  69 tests with zero errors or skips; exact evidence is in `python-linux-validation`.
- The first Windows full regression was interrupted during a host disk-space
  failure and does not count as a completed run. New runs use the short task-owned
  temporary root `D:\se-tmp` to avoid both system-drive exhaustion and incidental
  Windows Git path-length limits.
- System-drive capacity was restored by copying and SHA-256 checking 6,562 npm
  content-cache files to the D drive, then retaining access through a junction at
  the original cache path. No cache content or credentials were discarded.
  The external relocation manifest records the complete reversible copy.
- Final full regression, isolated install, source archive and link checks remain
  in progress. An earlier Docker validation environment failure is recorded, not
  reported as successful Linux SDK testing.

### Provenance checkpoint and final validation

- Checkpoint `d99427d7ad6c6a641a5d24bba12fedd58bb86864` includes the controlled
  resident Codex catalog fixture, its declared source transformation and updated
  exact provenance selectors. The original upstream hash is unchanged. All 247
  runtime files regenerate exactly, and the five Linux native adapter/catalog
  probes pass without changing production behavior, assertions or test timeouts.
- The independent candidate ledger closes 1,277 files and 3,459 original content
  occurrences, with no unresolved candidate or baseline contradiction. The one
  concurrently sampled baseline entry now points to its authoritative Git blob;
  its original working-copy observation remains in the correction record.
- The checkpoint naming gate inspected 3,291 source and generated files and all
  908 eligible JavaScript/TypeScript files. All 5,925 retained matches have exact
  selectors; unexplained matches, stale selectors and errors are zero.
- `baseline-preservation.json` independently verifies that all 12 original dirty
  documents still match their initial SHA-256 snapshots and that their separate
  documentation snapshot commit preserves the attribute-cleaned Git contents.
  The publishing remote still points to the originally recorded baseline commit.
- The Windows remaining regression process is still active. One Git control
  case exceeded its original 60-second timeout during the long run; the complete
  run and a targeted retry are required before accepting that case. The partial
  run is not reported as a passing full suite.
- The final Linux full-history clone has passed provenance checks, exact
  regeneration and type checking at the checkpoint. Its complete SDK suite,
  build and package smoke are running with the original test requirements.
  The 69-test Python input tree is unchanged at this checkpoint.
- The 60-symbol, 420-reference environment audit is specifically SDK scope.
  Independent review identified additional root and research workflow chains;
  a separate repository-wide audit is being added rather than treating the SDK
  inventory as evidence for those chains.
- Package and source-archive audit reports preserve the earlier verified
  artifact facts and explicitly mark the new canonical artifacts pending. The
  final deliverables must include the newer fixture/provenance revision and
  final reports, with fresh hashes and independent checks.

### Independent regression findings and corrections

- The first complete Linux run returned 2,767 passes, 23 failures and ten existing
  optional native-binary skips. Its logs remain intact. Sixteen failures came
  from comparing renamed workflow names with the original semantic digests;
  the new exact 282-edit proof reverses only naming changes in 18 workflows and
  preserves every original semantic hash. The two example suites now pass all
  32 tests, including their unchanged portable Skill staging assertions.
- A fresh Git clone exposed two original RRSI data files omitted from the renamed
  Git tree because `data/` is ignored. Both are now explicitly staged with their
  exact original Git blobs and modes. The new source-delivery gate checks all
  1,996 original paths, 78 executable modes and 12 source manifests containing
  836 pinned files. It reproduces exactly the two historical omissions at the
  previous checkpoint and passes against the corrected index.
- The existing incomplete-method test assumed the v2 design directory did not
  exist, although the publishing baseline already contains its three design
  files. The corrected test protects the incomplete classification, absence from
  the completed-method table, Git-on v3 settings, disabled reconfiguration and
  exact workflow/requirement equality with the research originals.
- Two Windows timeouts coincide with independently exported system sleep/wake
  events. Both original cases pass with their original assertions and deadlines
  when rerun. A temporary thread-scoped system-required request keeps validation
  awake and is released when its helper exits; no power plan is changed.
- Four other Linux failures pass under the original requirements after the host
  resumes. The remaining subprocess lifecycle case is reproduced as a PID 1
  zombie in a container without an init process and passes with Docker `--init`.
  The validation command now uses that standard process-reaping configuration.
- The whole-repository environment audit covers 90 symbols and 1,678 original
  references across 110 candidate files. Its 23 executed probes cover both MCP
  hosts, seven forwarding families, real embedded consumers and isolated workflow
  generation. Eleven unchanged research contract tests also pass in an isolated
  copy. These executed checks are separate from the static occurrence ledger.
- The environment probes confirmed an inherited documentation mismatch: optional
  backend authentication still requires the token source variable to be defined
  because `envFrom` rejects undefined values. Authored source and generated
  documentation now explicitly describe an empty token for unauthenticated
  operation. Runtime forwarding and authentication behavior are unchanged.
- CI now includes source-delivery, full-history generation/semantic verification,
  repository environment auditing, actual environment probes and isolated research
  contract tests. Its overall SDK job budget accommodates the full slow Git suite;
  individual test deadlines and assertions are unchanged. Remote CI has not run.
- Final Linux validation will run from a new clean checkpoint with `--init` and
  the temporary awake request active. Final package/source artifacts and their
  independent acceptance remain pending until those results are collected.

### 2026-10-16: immutable implementation and report freeze

- Implementation commit `05d84e8870f0926157883f7a7b49279e53c623df` contains the
  completed implementation, original source-delivery repairs and regression
  protection. Subsequent repository changes are confined to these root reports.
  The publishing remote was rechecked and remains at `4160a2c`; all twelve
  pre-existing dirty documents still match the preserved original snapshots.
- A new full-history Linux clone at that immutable implementation passed all
  2,790 SDK tests with ten existing optional installed-native skips and zero
  failures across 114 files. Runtime integrity, exact 247-file regeneration,
  all 18 semantic workflow reversals, type checking and the clean build pass.
  All 69 Python tests, 23 environment probes and eleven original research Node
  tests pass against independently identified final inputs. The complete
  installed-package smoke passes, including main/legacy entrypoints, MCP,
  SQLite, Git, generated workflows, lifecycle and signal recovery.
- The completed Windows run union covers all 2,800 unique cases: 2,468 passes,
  332 explicit platform/native-capability skips and zero unresolved failures.
  Both host-sleep timeouts pass unchanged retries. The report retains every
  historical failure and does not represent the union as one atomic green run.
- The canonical Linux-produced npm archive contains 1,314 files and is
  33,245,469 bytes, SHA-256
  `bba320502ce3963c43361fcd0bbc945ed5804f6058f42a88d5b1962cb26cdc9d`.
  Independent Windows installation matches every unpacked member exactly.
  All 53 exports/types, nine real command-wrapper invocations and 21 Skills
  were checked. Recompilation from exact raw Git blobs with TypeScript 5.9.3
  reproduces every generated distribution byte. Host checkout newline
  differences are explicitly distinguished from canonical source identity.
- The final link review covers 722 Markdown files and 1,128 relative links,
  with zero rename-introduced failures. Nineteen inherited third-party source
  gaps remain identified. The npm package separately retains five inherited
  third-party gaps and two existing links explicitly intended for the complete
  source tree; these are recorded rather than reported as installed resources.
- The naming gate inspects 3,310 source/generated files and all 913 eligible
  JavaScript/TypeScript files. Its 6,207 retained matches are explained by 124
  precise selectors; unexplained residues, stale selectors and errors are zero.
  All 1,277 naming candidates, 90 environment symbols and 1,678 environment
  references have explicit conclusions. The 838 original third-party files
  match their original working bytes, committed Git blobs and modes.
- The temporary global npm cache junction has been removed and the ordinary
  system-drive cache directory restored. Five complete path/size/SHA-256 lists
  agree for all 6,562 files (4,415,942,141 bytes). The external restoration
  receipt preserves the operation and hashes. The task-owned awake helper is
  released after final source validation; its terminal status belongs in the
  detached receipt. No power-plan setting is changed.
- The final source archive must use explicit local Git settings
  `core.autocrlf=false`, `core.eol=lf` and `tar.umask=0022`. Every member must match
  the frozen Git tree's bytes and executable mode before clean extraction,
  dependency installation, build, delivery checks and Git-independent scans.
  Archive hashes and the final source report live outside the archive, avoiding
  a circular self-hash or an untested success claim in these frozen documents.
- No remote CI, macOS, paid-model or scientific benchmark acceptance is claimed.
  Anonymous registry/repository checks do not establish publishing rights.
  The SDK still has `private: true`; namespace ownership, release destinations
  and the authorized publishing setting remain external release prerequisites.
  Local completion does not push, merge, rename remote repositories or publish.
