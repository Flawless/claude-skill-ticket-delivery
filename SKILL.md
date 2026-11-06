---
name: ticket-delivery
description: Take a ready ticket to a reviewed PR with a multi-agent Workflow — design spec and an independent test plan, an implement↔review loop inside a test loop (the implementer runs the gate; CI and system tests on a shared stand prove it), DB plan evidence, PR, tracker moves. Not for one-file fixes or pure investigations.
---

# Ticket delivery

- [process.md](process.md) — the stages in order, each with its exit condition and the reason behind each rule
- [workflow.js](workflow.js) — the Workflow script from design to system test; its args are documented at the top
- [schemas/](schemas/) — one JSON Schema per document below, each field described, with an example
- `project.md` — the project profile, read from the project's `.claude/skills/ticket-delivery/project.md`.
  This copy is only a [template](project.md). No profile → ask for the missing fields, do not guess.

## Documents

Each agent hands over one document, as JSON. Names and structure are adapted from the standards cited, without
a claim of conformance; editions, status and links are in [references.md](references.md).

| Document | Written by | Adapted from |
|---|---|---|
| Design specification | designer | IEEE 1016-2009, software design descriptions (inactive since 2020) |
| Test plan, with test case specifications | test designer, without the design | ISO/IEC/IEEE 29119-3:2021, test documentation |
| Build record (commits, automated tests, gate) | implementer | ISO/IEC/IEEE 29119-3:2021 (test log, for the gate) |
| Review report | each reviewer lane | IEEE 1028-2008, software reviews and audits (inactive since 2019) |
| Test report | system tester | ISO/IEC/IEEE 29119-3:2021 (test execution log, test status report) |
| Traceability matrix | the script, rendered | ISO/IEC/IEEE 29148:2018, requirements traceability |
| Run record | orchestrator, at close out | ISO/IEC/IEEE 29119-3:2021 (test completion report) |

## Running it

Load `agent-workflow-design` and `workflow-authoring` first.

Intake and branch (process §1–2) happen before the run. Then run `workflow.js` by `scriptPath`, with a new
`run_id` and every `schemas/*.schema.json` parsed into `args.schemas`, keyed by file name without
`.schema.json`. Evidence, PR and close out (§5–7) work from its return:

- `{stop}` → ask the user the blocking questions, put the answers in `facts`, run again.
- `verdict`, `traceability`, `rounds`, `residue` → the report and the PR body.
- `open_findings` → re-grade each minor that scans, leaks across tenants or breaks a project rule; any upgrade
  goes back in as `facts` for another run. Name a follow-up for every finding left in the PR.
- `incidental` → relay to the user.
- `artifacts` → every document in an envelope (run, stage, round, model, commit); the input for the run record.

## Non-negotiables

- The problem and the acceptance criteria are the spec. A solution proposed in the ticket is a hypothesis:
  verify it against code and data, and say why if the design departs from it.
- Branch from a fresh fetch of the default branch, in its own worktree. Never touch the user's checkout.
- One writer at a time; reviewers are read-only, run in parallel, and never a cheaper tier than the writer.
- A clean review is not a pass. Only the system tests on the stand prove the acceptance criteria.
- Shared-stand deploys need the user's explicit go for this task. Production is read-only; the user runs anything there.
- Outward actions (PR, ticket moves, comments, attachments) only on request; show new text first.
- No secrets in args, logs or prompts; no customer data in public places (PRs, chat channels).

## Report to the user

Per round: commits, blocking and minor counts, gate result, system test results per test case. Then the
traceability matrix, evidence links, what was not verified and why, residue on the stand.
