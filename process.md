# Process

If a stage's exit condition is not met, the stage repeats or the run stops and reports.
A rule's reason follows it in italics where it is not obvious.

## 1. Intake

- Read the ticket: why, acceptance criteria, out of scope, linked investigations.
- Check every claim the ticket makes about current behaviour against code or data, and separate the problem
  from any proposed fix or suspected cause. *Tickets describe screens that don't show what they say, and
  first explanations get disproved by data.*
- Before calling two records duplicates, find what links them. *A "duplicate" is often one entity at two stages.*
- Give every criterion a stable id (`AC1`…); every document refers to it.
- Quality requirements rarely come with the ticket. The test designer collects them in §3 from the ticket, the
  profile's baseline and the change itself; the user does not need to supply them up front.
- Move the ticket to "in progress" (profile). Assign it if asked.
- Exit: every criterion is testable as written. If one is not, ask before building.

## 2. Branch

- `git fetch`, then a worktree on a new branch from the remote default branch, named per the profile.
- Do the profile's worktree setup. `.tmp/run/` must be git-ignored; the run writes there.
- Exit: dependencies resolve; `git status` is clean.

## 3. Design specification and test plan

Two agents in parallel.

- The designer writes the design specification (`schemas/design-spec.schema.json`), including the logs,
  metrics, traces, alerts and dashboards that make the change diagnosable.
- The test designer writes the test plan (`schemas/test-plan.schema.json`) from the criteria, the profile's
  baseline and the current behaviour only, without the design. *Tests written by whoever designed the solution
  test that solution, not the requirement.*
- The test plan lists the quality requirements for this change: the ticket's, the baseline items that apply,
  and ones derived from the ISO/IEC 25010 characteristics, each with a metric, a threshold and the smallest
  environment that proves it. Derived ones are proposals: their failures go to the user, never back to the
  implementer.
- Exit, checked by the script: an entry per criterion and an index per query in the design; a test case per
  requirement and unique ids in the plan. Blocking open questions stop the run for the user.

## 4. Test loop (3 rounds at most)

### 4a. Implement ↔ review (3 rounds at most)

- The implementer commits, implements every test case that runs locally as an automated test, answers
  every open finding id (fixed, disputed, or deferred for minors only), then runs the profile's gate commands
  and the touched tests at its final commit. All of it goes in the build record
  (`schemas/build-record.schema.json`). Missing answers are asked for once more.
- The script checks the build record: every local test case has a test, the gate ran on the head
  commit, every exit code 0. A failure goes straight back to the implementer, without review. The record is a
  claim; CI in 4b is the independent check.
- Tests set every ordering value they assert on. *A fixture relying on sequence values passed on a long-lived
  local database and failed in CI on a fresh one.*
- Two read-only reviewer lanes (backend correctness; criteria as a user sees them) verify the answers, then
  report new findings (`schemas/review-report.schema.json`). Reviews of any other commit are discarded.
- Anything whose cost grows with table or history size is blocking. *A reviewer graded "reads every saved
  version of a record" as minor; on production that is unbounded.*
- A finding closes only when a reviewer marks it resolved and none marks it unresolved. Deferred minors come
  back in `open_findings`.
- Exit: gate green, no blocking finding open, both lanes returned and reviewed the head. Otherwise the next
  round starts without the stand.

### 4b. CI and stand test

- Push and wait for CI on the head. Not green → a failure for 4a, with the failing job; no deploy.
- Deploy, and confirm the stand reports that build. *A stand once still ran an older build; results from it
  test nothing.*
- Seed through the real pipeline, reusing earlier seed. *Two clean reviews missed a parser bug the first real
  file exposed.*
- Run every stand case into the test report (`schemas/test-report.schema.json`): functional cases in a browser,
  read from the DOM; performance cases as plans, then measurements labelled with the stand's table sizes;
  operational cases by triggering the event and finding it in the stand's logs, metrics or traces. The script
  compares every measurement to its threshold and rejects a verdict that contradicts it. Record residue.
- A shared stand proves plan shape and observability, not production speed under load. Cases that only
  production can prove come back as `production_checks` for the user.
- Check where tools can read and write before planning evidence around them; move files out of the user's
  checkout at once. *Browser tools and tracker connectors are sandboxed to fixed directories.*
- Exit: CI green, the build is the head, every stand case passed except those of derived quality requirements.
  Failures go back to 4a. No access, no seed or deploy infrastructure down stops the run as blocked.

Every agent prompt carries the full text of what to do or check; ids only cross-reference.
*An agent told to check "B2–B6" without the list had to guess from commit messages.*

## 5. Evidence

- Label every number with its environment and that environment's size, read from both environments'
  catalogs (row counts, index lists). *A "production-scale" copy was 5% of production and had indexes
  production lacks.*
- Plain `EXPLAIN` before any statement on shared data; `EXPLAIN (ANALYZE, BUFFERS)` only once every plan
  uses its index. Write filters in the index's own expression form. *A partial index was skipped because
  the query used `->>` where the index predicate used `#>>`, and the query scanned the whole table.*
- Production: hand the user statements in their console's batch format, including every `production_checks`
  case; the user runs them. Include a plain query whose result is known from the investigation; it proves the
  logic, not only the speed.
- When replacing a statement the user already has, say not to run the old one, and give the cancel query
  with anything heavy. *A withdrawn query was run from scroll-back.*
- Redact ids, tenants and timestamps before the first public post. *Edits keep history.*

## 6. PR

- If no stand round ran, push and wait for CI on the head; mark the PR ready only on green CI.
- PR body per the user's rules: why, what, impact, verification commands, the `traceability` matrix, what
  was not verified. Failed derived quality requirements go in as proposals for the user to accept or drop.
- Evidence as a redacted PR comment. Draft while anything is pending; ready when asked.
- Move the ticket to review.

## 7. Close out

- Report residue on the stand and who deletes it when.
- Delete temp tokens and credential files.
- Run record (test completion report), when one is wanted: the returned `artifacts`, verdict and PR link,
  plus each agent's usage summed from its transcript (input, cache write, cache read, output) and priced with
  prices dated in the record. *The script cannot measure usage: output-token counters are shared with everything else running.*
- A new failure mode becomes a rule here, with its reason, or a check in `workflow.js`.
