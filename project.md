# <project>

Template. A project keeps its filled copy at `.claude/skills/ticket-delivery/project.md` in its own
repo. Pointers only: never put passwords, tokens or keys here — say where they live.

## Tracker

Project key, how the agent reaches it (connector or CLI), transition names/ids for in progress, review,
done. Ticket link format. Who may be assigned.

## Branch and PR

Default branch, branch naming rule (and the hook that enforces it), commit message rules and trailers,
PR host, CLI and account to use, required PR sections, required checks.

## Worktree setup

Steps a fresh worktree needs before it builds: shared artefacts to symlink, env files to copy, dependency
installs, files to exclude from git status.

## Gate commands

Exact lint, type check, format, drift and test commands. How to focus backend tests. Harness caveats
(database container, env vars, temp files that must be cleaned after each run).

## Stand

Stand URL(s), how a branch gets there (CI image, deploy command, how long each takes), how the running
build reports its commit, who must approve a deploy. Where access details are documented.

## Seeding

Tooling that creates realistic records through the real pipeline, and how to point it at the stand.
What residue it leaves and how to delete it.

## Browser

Which browser automation tools exist, their sandbox limits (where screenshots can be saved), how to
authenticate as an admin without SSO.

## Database evidence

Console for each environment, its batch format, who may run what (production: the user only). Table
sizes per environment, and indexes that differ between environments.

## Data hygiene

What counts as sensitive data here, which destinations are inside the boundary (tracker?) and which are
public (code host?), what to redact.
