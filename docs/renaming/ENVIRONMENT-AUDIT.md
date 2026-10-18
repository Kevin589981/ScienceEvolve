# Whole-repository environment naming audit

[The machine report](environment-audit.json) links every environment-related
uppercase prefix occurrence in the authoritative baseline Git blobs to its
candidate ID, inventory occurrence, original position, current symbol and exact
current line hash. It reports static evidence separately from executed probes.
Recorded raw SHA-256 observations retain their original platform scope. On a
different checkout, only an explicitly permitted Git-attribute CRLF/LF conversion
may substitute for raw equality: the actual Git blob and canonical SHA-256 must
match, and the canonical bytes must be obtainable by CRLF-to-LF alone. Fixed
originals and `-text` files require exact bytes. Both identities are reported.

The denominator is the original 1,996 tracked files and 1,277 naming candidates.
There are 110 candidate files with 90 distinct environment-related symbols and
1,678 occurrences. Symbols include complete keys, test markers, dynamic prefixes
and generator family bases. All 1,678 occurrences have exact current anchors;
1,627 were renamed and 51 remain precise original evidence. Mapping collisions
and unresolved references are zero.

| Baseline location | Occurrences |
| --- | ---: |
| SDK source, scripts and tests | 420 |
| SDK documentation | 22 |
| Immutable upstream patch evidence | 48 |
| Research workflows, scripts and documentation | 669 |
| Example workflows and requirements | 492 |
| Root English and Chinese README | 20 |
| Agent skill instructions | 5 |
| Historical root SDK report | 2 |
| Total | 1,678 |

The earlier candidate ledger's 60 symbols and 420 references describe SDK source,
scripts and tests. This audit reconciles that exact multiset by candidate,
original line and original symbol digest. It adds the other repository surfaces
without changing the earlier ledger or presenting preserved patch/history text
as executable configuration. The 51 retained occurrences consist of 48 original
patch references and three historical report references, each linked to existing
precise exception IDs.

All 30 tracked example/research workflow JSON files are decoded. Their 106 MCP
definitions use seven distinct `envFrom` mappings. Every explicit product-prefixed
`process.env` consumer in their embedded files has a matching child target or one
of the SDK's three injected variables. No target is unused. Operator host keys,
child targets, embedded file hashes and consumer offsets are recorded per
definition. Source references and new test/documentation symbols are also
enumerated separately; generated distribution files are covered by the release
branding gates.

| Mapping family | MCP definitions |
| --- | ---: |
| AI Scientist root, local proxy and dependency anchor | 24 |
| Biomni backend URL, token and scope | 18 |
| Chemical backend URL, token and scope | 18 |
| InternAgent backend URL, token and scope | 22 |
| Raven backend URL, token and scope | 12 |
| AlphaEvolve scientific state root | 5 |
| Kosmos scientific state root | 7 |

The 23 executed probes use the actual built main and legacy MCP hosts and the
workflow's unchanged embedded service source. Each host exercises all seven
mapping families through real materialization, process startup, stdio MCP and a
read-only state tool. The backend fixtures verify the actual scope and bearer
header. AI Scientist reads the real experiment contract with the renamed seed
variable; its proxy and dependency-anchor consumers load the installed HTTP
client and reach a rejecting loopback proxy. The proxy never opens an upstream
socket. Additional probes observe all three SDK injections, explicit forwarding,
absence of an unmapped secret, and rejection of missing operator configuration.
The seed variable remains a declared atomic CPU-job contract. These read-only
probes verify the service exposes that contract; they do not run the external
scientific CPU host that would provide the variable to an actual experiment.

An isolated execution of the actual workflow generator verifies all 70 generated
backend definitions against the corresponding research/example mappings, all
eight requirement files, and all eight embedded backend documents. Line ending
normalization is permitted for document comparisons. All 23 probes passed. They
make zero external connections, call zero models, and launch zero scientific
jobs. Their local SQLite files and generated outputs remain under the explicit
temporary fixture directory recorded in the report.

The probes exposed a preexisting documentation ambiguity: authentication is
optional, but every `envFrom` source must exist. Both original host Git blobs
already contain the exact current undefined-variable guard, while the original
bridge already omits authentication for a blank token. The original generator
called the token optional without explaining that presence requirement. The
first-party generator, backend document, eight requirements and eight embedded
documents now state that an unauthenticated backend requires an explicitly empty
token variable. Both hosts reject an undefined token and successfully call the
local backend without an Authorization header when the token is empty. Runtime
semantics and environment mappings have not changed. Original/current line
hashes and all 18 corrected file hashes are retained in the report.

The existing Linux Python suite passed 69 tests without skips. Those tests cover
scientific adapters, original source pins, algorithms and local file/Git behavior;
their runner discovers only `example/tests`. They do not execute these environment
configuration chains and are not counted as additional environment probes.
The supplied suite's workflow snapshot is compared with the current files in
the report. Earlier successful runs remain evidence for their recorded input
hashes; a changed workflow snapshot requires fresh final Python evidence.

The two existing research Node test files also passed unchanged: three Raven
contract tests and eight real task-bridge transport tests, 11 passes with no
failures or skips. An isolated runner copies the original test/bridge bytes,
checks their SHA-256 equality, and borrows the installed dependencies and built
SDK modules. All test-created fixtures stay outside the checkout. The report
retains the full command, input hashes and complete TAP log. These tests use
local module calls and loopback HTTP; they do not call models or scientific
services.

To reproduce after building the SDK, run the following from the repository root.
The fixture path is explicit, and no existing workflow is overwritten:

```powershell
$env:TEMP = 'D:\se-tmp'
$env:TMP = 'D:\se-tmp'
node scripts/validation/probe-environment.mjs --temp-root D:\se-tmp --report D:\se-tmp\environment-runtime.json
node scripts/validation/run-research-node-tests.mjs --temp-root D:\se-tmp --report D:\se-tmp\research-node-tests.json
node scripts/validation/audit-environment.mjs --output docs/renaming/environment-audit.json --probe-report D:\se-tmp\environment-runtime.json --research-report D:\se-tmp\research-node-tests.json
```

Use `--python-report <path>` to attach the independently executed Python evidence.
The audit fails on an unmapped original occurrence, SDK denominator mismatch,
name collision, missing embedded consumer mapping, failed baseline contract proof
stale candidate/consumer input snapshot, or failed supplied runtime probe. It does not claim to validate availability or
scientific correctness of an operator's real backend.
