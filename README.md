# ticket-delivery

A [Claude Code](https://claude.com/claude-code) skill that takes a ready ticket to a reviewed PR with a
multi-agent Workflow: a design specification and an independently written test plan, an implement↔review
loop inside a test loop, CI and stand tests (functional, performance, operational), quality requirements
derived when the ticket has none, database plan evidence, and a traceability matrix for the PR. Agents hand each other documents as JSON Schemas adapted from ISO/IEC/IEEE 29119-3,
29148, ISO/IEC 25010/25023 and IEEE 1016/1028 ([references](references.md)).

Status: draft, shared for review. Used once end to end on a real ticket; the current document structure
has only been dry-run with stub agents.

## Read in this order

1. [SKILL.md](SKILL.md) — what the skill does, the documents, how to run it, the rules that never bend
2. [process.md](process.md) — every stage with its exit condition and the reason behind each rule
3. [schemas/](schemas/) — the documents agents exchange, each field described, with an example
4. [workflow.js](workflow.js) — the Workflow script: control flow and the contract checks between agents
5. [project.md](project.md) — the profile template a project fills in

## Try it

```bash
git clone https://github.com/Flawless/claude-skill-ticket-delivery.git
ln -s "$PWD/claude-skill-ticket-delivery" ~/.claude/skills/ticket-delivery
```

Fill in `project.md` for your project and keep it at `.claude/skills/ticket-delivery/project.md` in that
project's repo. It needs Claude Code's Workflow tool and its built-in `workflow-authoring` skill. SKILL.md also
loads `agent-workflow-design`, a personal skill not published here; without it, the model choices in
`workflow.js` still apply.

## Review

Open an issue or a PR. Most useful: contradictions between files, rules the script doesn't enforce, and
anything an orchestrating agent following SKILL.md would not know how to do.
