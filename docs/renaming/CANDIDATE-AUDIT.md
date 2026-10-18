# ScienceEvolve candidate closure audit

The [candidate ledger](candidate-resolutions.json) resolves all 1,277 baseline files
and 3,459 content occurrences against the actual Git blobs at
`ff776f1e82f04fdb51d9cb4d4fa275b965d89703`. No candidate, occurrence, original
environment reference or baseline consistency issue remains unresolved.

Each record links its candidate number to the baseline JSON pointer, current path
and SHA-256, authoritative original Git blob and SHA-256, and its verification
source. Original names are referenced by candidate IDs and symbol digests rather
than copied into a second inventory.

| Final disposition | Files | Evidence |
| --- | ---: | --- |
| Exact declared renaming | 275 | Complete current bytes equal the declared occurrence edits |
| Exact occurrence anchors with associated edits | 21 | Current line hashes or exact retained field selectors |
| Exact replay of reviewed associated edits | 20 | Complete forward and inverse edits against the fixed verification checkpoint |
| Reversible runtime overlay | 53 | Reverse executable pins and branding to the original complete blob |
| Original bytes preserved | 17 | Current bytes equal the original Git blob |
| Pinned originals restored from checkout normalization | 798 | Current bytes equal the original Git blob and the declared pin |
| Non-text original assets preserved | 93 | Byte-for-byte original Git blob equality |

Twenty candidate files have an additional exact replay proof against checkpoint
`d99427d`: 18 owned environment-contract documents, the root verification command
wiring and the research-example test. The document proof accepts only the precise
clarification of the existing token contract: authentication is optional, while
an `envFrom` source key must be explicitly defined even for an empty token. All
other bytes, executable bridge text and runtime maps must match. The 33 affected
original naming occurrences retain checkpoint-line and current-line hashes.
The semantic-migration test and CI wiring have two additional non-candidate proofs;
they do not increase the original candidate count. Each of these 22 records stores
exact edits, the fixed Git blob, forward/reverse verification and the working-copy
newline reconstruction. No residual exemption is added.

The semantic proof independently reproduced 282 exact naming edits across 18
workflows and recovered every unchanged historical semantic hash. The research
test preserves complete method staging and now checks the original incomplete
design boundary, Git-on schema, disabled reconfiguration and exact research-source
equality rather than asserting that already-existing design files are absent.

Every candidate also records `currentGitBlob` and `currentGitCanonicalSha256`.
These are calculated through one actual Git attribute/clean-filter batch and
verified against reconstructed canonical bytes. `currentSha256` remains the exact
observed Windows working-copy hash, with its newline counts and platform recorded.
When `byteExactRequired` is false, another checkout can use the proven Git identity
to recognize a CRLF/LF equivalent. Fixed originals, non-text assets, runtime source
proofs and `-text` files require exact raw bytes; their source hashes are unchanged.

The resident Codex fixture has one additional declared 188-byte catalog response.
The ledger reverses that exact insertion once after reversing branding, then
compares the complete result with the baseline blob. Its immutable upstream hash
is unchanged. Generation from the actual fixed upstream commit reproduced all
247 runtime files and metadata exactly. A separate execution of the real fixture
and production parser verified the ordinary catalog and the existing specialized
compatibility override; the Linux runtime suite is reported separately.

Candidate C1130 originally captured an intermediate working copy while parallel
provenance edits had begun. Its inventory entry now uses the authoritative Git
blob and original positions. `snapshotCorrection` preserves the captured hash and
positions, and the ledger verifies both retained rule occurrences explicitly.

The SDK executable/source/test environment audit maps 60 distinct original symbols:
58 complete keys or test markers and two dynamic prefixes. All 420 references in
that SDK scope have exact current
line evidence, including main and legacy producers, reads, descriptors, forwarded
allowlists and child-process templates. The current reference count is also 420.
The two historical prefix families produce no mapping collisions. The separate
[repository-wide environment audit](ENVIRONMENT-AUDIT.md) and its
[machine-readable evidence](environment-audit.json) also cover root and research
workflows, documentation, embedded consumers and environment forwarding contracts.

The protocol audit checks 35 distinct identifiers with no direct mapping
collisions. Four raw/display pairs already shared a display projection in the
baseline; the ledger records both baseline symbol IDs, scopes and original
projection digest. They do not represent new merges introduced by the rename.

| Current tool | Existing representations | Verification |
| --- | --- | --- |
| Workspace append | Runtime hyphenated namespace; provider-specific underscore display | Both engines preserve each name verbatim |
| Workspace smoke sentinel | Runtime hyphenated namespace; provider-specific underscore display | Both engines preserve each name verbatim |
| Orchestration route | Runtime hyphenated namespace; protocol-test underscore input | Both engines preserve each name verbatim |
| Sii experiment get | Explicit raw and sanitized native-result aliases | Real result-matching method accepts both forms and the server/name pair |

These checks do not claim that every common catalog accepts arbitrary aliases.
The common catalog keeps names verbatim. All 16 real main/legacy protocol name
probes passed, and all three real Sii native-result probes passed without network
or model calls.

The public entrypoint audit hashes all 53 import targets and 53 type targets,
including nested wildcard exports. All 52 library targets import successfully.
The HTTP MCP bridge is an existing configured executable entrypoint; an isolated
child process confirms its expected missing-configuration rejection. The default
factory equals the main factory, the explicit legacy factory remains separate,
and both CLI engines report the package version through `scienceevolve.mjs`.

Exact preserved history, source patch text, licenses and existing remote links
remain separately constrained by the precise branding exceptions. This audit
does not turn them into broad residual exemptions. Package and source-archive
acceptance have separate reports because their file sets and execution contexts
differ from the baseline candidate set.
