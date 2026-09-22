# Architect Hackathon

A local browser control center for AI-assisted hackathon development.

Architect keeps the **target repository** as the source of truth while coordinating Codex execution, deterministic verification, secret requests, Git visibility, browser evidence, and final submission audits.

## Why

The intended workflow is:

```text
Human product decision
        ↓
ChatGPT architecture / review
        ↓
Repository state (.architect/*)
        ↓
Codex implementation
        ↓
Tests + build + browser evidence
        ↓
Human/ChatGPT checkpoint review
```

Architect removes manual prompt-copying and terminal monitoring without replacing high-value product judgment with an expensive API orchestration loop.

## Requirements

- Node.js 20.9+
- Git
- OpenAI Codex CLI installed and authenticated
- A local target Git repository

For screenshot capture, install Chromium once:

```bash
npx playwright install chromium
```

## Run

```bash
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).
The development and local production servers bind to `127.0.0.1`.

Enter the absolute path to the hackathon/project repository.

## What Architect creates in the target repository

```text
AGENTS.md
.architect/
├── TASK.md
├── ARCHITECTURE.md
├── PROJECT_STATE.md
├── ACCEPTANCE.md
├── DECISIONS.md
├── HOURLY_LOG.md
├── requests/
├── team/
│   └── state.json          # created only when Team Mode is used
├── reports/
│   └── latest.md
└── evidence/
```

Architect also keeps local runtime settings such as the selected project, timer, and change proposals outside the target repository. The optional Solo/Team switch is stored in this browser for each project.

## Optional Team Mode (Stage A)

Solo is the default and retains the existing milestone run workflow. Team Mode adds three editable worker records, scoped task assignments, dependencies, worker-reported verification, and local Git branch inspection. It does not launch Codex on teammate devices or synchronize state automatically.

For a manual three-device workflow:

1. Create a task in Team with a task-specific branch name, owner, scope, and acceptance criteria. Architect records the current local `main` or `master` commit as its base. It does not create the branch.
2. Commit and push `.architect/team/state.json` in the target repository when the assignment is ready to share. Teammates pull that commit and create or fetch their task branches on their own devices. Keep credentials in each device's local environment.
3. The worker updates the task status and reports a commit and verification result through Architect on the shared project checkout, or coordinates those state edits manually through Git. Avoid concurrent edits to `state.json`; Stage A has no multi-device live synchronization or conflict resolution.
4. Fetch task branches locally to inspect changed paths and scope warnings. Review an outdated base before integration. Merge and verify through Git outside Architect. **Mark integrated** succeeds only when the reported task commit is on its task branch, descends from the recorded base, and is present on local `main` or `master`.

Branch work is shown separately from integrated project progress. Change proposals can show team impact, but applying a proposal does not cancel or create team tasks. Those changes require explicit Team actions.

## Codex execution

The **Run milestone** button launches:

```bash
codex exec --json --sandbox workspace-write -
```

Architect sends the current milestone prompt over stdin. Codex is instructed to implement only that milestone, update project state, and request approval before major architecture changes.

Architect holds `.architect-runtime/execution.lock` during a milestone run. If the app stops mid-run, it blocks another run until you inspect the recorded process and confirm the earlier Codex process has ended before clearing the lock.

Current Codex documentation recommends explicit `workspace-write` sandboxing for non-interactive automation rather than the deprecated `--full-auto` compatibility flag.

## Secrets Inbox

If Codex needs an environment variable, it creates:

```text
.architect/requests/secret-OPENAI_API_KEY.json
```

Architect displays an action card. The pasted value is written to the target repository's local `.env.local`, which Architect adds to `.gitignore`.

Secret values are never written to Architect markdown state.

A staged Git diff is scanned for common secret patterns during verification.

## Verification

After Codex exits, Architect automatically runs available package scripts:

- `npm run typecheck`
- `npm run test`
- `npm run build`

Missing scripts are reported as skipped rather than failed.
Automatic verification currently supports npm projects with at least one of these scripts. Other project types are marked unverified in the audit.

## Browser evidence

Enter the running target application's URL and capture a desktop or mobile viewport.

Evidence includes:

- full-page screenshot
- viewport
- URL
- timestamp
- console errors
- failed network requests

Artifacts are stored under `.architect/evidence/` in the target repository.

## Final audit

The final audit checks:

- typecheck/test/build where configured
- staged diff secret scan
- required Architect documentation
- README presence
- Git repository state
- environment-variable documentation

This is a readiness tool, not a guarantee of hackathon scoring.

## Security model

V1 is intentionally local-only.

- No Supabase/database
- No hosted backend
- No arbitrary shell-command HTTP endpoint
- Codex receives workspace-write access only
- Major new services/architecture should go through structured approval requests
- Secrets remain local and Git-ignored

Do not expose this development server to an untrusted network.

## Limitations

- The user must install/authenticate Codex CLI separately.
- Playwright Chromium requires a one-time local install.
- V1 does not automatically commit or push code.
- Approval requests are displayed but V1 does not yet maintain a formal approve/reject decision workflow.
- Long-running Next.js development servers should be started separately from Architect.
- Windows/macOS/Linux behavior has not yet been exhaustively tested.

## Development priority

This project is deliberately narrow for HackAlem preparation. Avoid adding cloud sync, auth, a database, a full terminal emulator, or autonomous API architect logic unless real usage demonstrates a need.
