# Naming coverage gate

From the SDK directory, run:

```sh
node scripts/check-branding.mjs --json /absolute/path/outside-the-checkout/branding.json
node scripts/check-branding.mjs --package-root /absolute/path/unpacked/package --json /absolute/path/outside-the-checkout/package-branding.json
node scripts/check-branding.mjs --source-root /absolute/path/unpacked/source --json /absolute/path/outside-the-checkout/source-branding.json
```

The repository scan combines tracked files, non-ignored untracked delivery files,
explicit first-party SDK delivery roots, and existing `sdk/dist`, `sdk/assets`, and
`sdk/schemas`. Explicit SDK roots prevent local Git excludes from hiding new source,
scripts, resources, tests, or root configuration. Dependency installations and other
unrelated ignored caches are outside these delivery roots. The package scan reads
every delivered file and path, without Git or directory ignore rules.
The source archive mode also scans every extracted file without Git, applying exact
repository-relative exception paths rather than the npm package path mapping.
For builds of extracted source, default mode recognizes an absent repository root
and uses a source-tree scan. It omits named dependency/runtime caches, reports every
omitted cache path, and includes generated output. Existing broken Git metadata and
other Git errors fail the check. An extracted tree needs no Git executable; explicit
`GIT_DIR`, `GIT_WORK_TREE`, or `GIT_COMMON_DIR` settings are verified rather than silently
discarded. Explicit `--source-root` remains an exhaustive archive
acceptance scan with no cache omissions.

UTF-8 and UTF-16 text, JSON keys, and decoded JSON string values are checked. Escaped
JSON spellings therefore cannot hide a retired token. UTF-16 with a byte-order mark
and common BOM-less ASCII-heavy UTF-16 are supported. Recognized text formats remain
text when PDF extraction introduced isolated control marks. All other assets are
listed with their byte digest and receive supplementary ASCII/UTF-16 byte-string
checks. These byte checks do not replace visual review, PDF extraction, or attribution
of third-party images and serialized research data.
Original JSON string tokens are compared with the parsed fields so duplicate keys
cannot erase an earlier retired value from the scan.

JS/TS delivery files, including compiled package JavaScript, also receive safe static
string folding with the installed lockfile-pinned TypeScript parser. Literal string
concatenation and fully static template expressions are evaluated from syntax only;
no source code runs. Computed hits are recorded only when the expression's original
source does not already contain a visible retired token. Counts record eligible and
inspected JS/TS files, evaluated static expressions, and parser availability/version.
Missing parser dependencies fail complete JS/TS verification explicitly; plain-text
scans still run and their partial results remain in the JSON report.

The report records every inspected path, origin, encoding, byte count and SHA-256;
every content/path hit; missing tracked files; non-text assets; unexplained matches;
and expired or changed exceptions. Deleted tracked paths are reported separately
because a valid rename leaves them absent before the rename is committed.
The default console output is a compact count summary. `--json FILE` saves the full
machine-readable report, while explicit `--json-stdout` prints that report to stdout.

`exceptions.json` contains only reviewed preservation decisions. An exception has:

- An exact repository `path`, with no path glob. A separate exact `packagePath` opts
  that same preservation into unpacked package checks.
- A selector for one JSON pointer, JSON key, exact line digest, exact path, or binary
  string encoding.
- The exact selected content's `contentSha256`, an `expectedMatches` count, and a
  specific `reason`.

For a JSON string field, the digest hashes its decoded string value. For an object
or array field, the digest hashes `JSON.stringify(value)`: all descendants are pinned
together to retain an immutable historical inventory or reversible source edit
record. Such a field cannot change or gain an additional match without failing.
For line selectors, the selector digest and content digest both hash the full line
without its line terminator. Lines are stable across CRLF/LF checkout settings.

An entry is stale when its content changes, its selector disappears, its file is
removed, or its aggregate match count differs. Adjacent current fields and additional
files receive no allowance. Overlapping exceptions are rejected. The gate has no
command to automatically accept unexplained matches. The exception list itself is
scanned as ordinary JSON; storing digests avoids duplicating retained source tokens.

Write raw scan reports outside the delivery tree. Immutable baseline inventories
inside the tree require their own reviewed field-level preservation, just like any
other retained historical evidence. A passing report proves the automated naming
checks; the execution record separately documents visual and platform validation.
