# Windows SDK acceptance evidence

All 114 current SDK test files have completed-run evidence. The deduplicated union
contains 2,800 cases: 2,468 passed, 332 explicitly skipped and zero unresolved
failures. This is a union of completed runs and unchanged targeted reruns; it is
not a claim that one complete invocation passed without failures.

The [machine-readable report](windows-sdk-validation.json) lists every file and
case, current inspected source hashes, original observations and log hashes. The
three primary logs' printed case counts exactly match their framework totals.
Test identity includes the complete displayed title and its within-run ordinal,
so two equally named event-bridge parameter cases remain separate. Reruns append
observations; their filtered skips do not increase unique case totals.

The original remaining invocation completed all 101 selected files with exit 1:
96 passed files, three skipped files and two failed files; 1,887 passed cases,
144 skipped cases and two timeouts. Separate runs cover the other 13 files.
The two original failures were:

| Case | Original result | Unchanged rerun |
| --- | --- | --- |
| Closing control rejects changed ownership epoch | 260,210 ms elapsed against the existing 60,000 ms deadline | Passed in 2,784 ms |
| Closing settlement rejects a new binding | 1,950,203 ms elapsed against the existing 120,000 ms deadline | Passed in 46,217 ms |

Windows System events prove idle sleep at 22:29:45–22:34:07 and
22:46:33–23:18:26 on 2026-10-15, matching the interrupted test periods. The report
records the event IDs, exact UTC intervals and XML digests. Original XML is retained
outside the repository at the report's evidence path. A validation-lifetime system
execution request prevented further idle sleep without changing the power plan.
The exact tests then passed with unchanged source/configuration hashes, assertions
and deadlines. Their two-file rerun exited 0, with two passes and 43 filtered skips.

Two earlier selected-run failures also remain visible: Windows Git path length in
the R04 pending-file test, resolved with the short task TEMP root, and a 100,000-event
seed exceeding its unchanged writer lease under contention, resolved by an isolated
unchanged rerun. All four historical failures retain their original failed
observations alongside later passes.

The 332 final skips are explicit Windows/native-binary/host-capability exclusions,
not successful execution. Each skipped case and its source eligibility checks are
listed. Linux resident coverage and real installed Harness acceptance have separate
reports. The test union does not represent line/branch coverage or external-model
quality acceptance.

The original tracked baseline contains 111 test files. Three new files cover the
branding gate, reversible branding and executable digest derivation, giving the
current 114-file inventory. The 32 example migration/delivery cases also have a
separate completed verification run after their strict source-proof adaptations.
The shared working tree changed while the long remaining invocation ran; source
hashes describe the final inspection snapshot, and the evidence does not represent
an atomic run from one immutable commit.
