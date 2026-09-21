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

- Node.js 20+
- Git
- OpenAI Codex CLI installed and authenticated
- A local target Git repository

For screenshot capture, install Chromium once:

```bash
npx playwright install chromium
```

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

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
├── reports/
│   └── latest.md
└── evidence/
```

The control application itself stores only the currently selected local repository path.

## Codex execution

The **Run milestone** button launches:

```bash
codex exec --json --sandbox workspace-write "<current milestone prompt>"
```

Codex is instructed to implement only the current milestone, update project state, and request approval before major architecture changes.

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
