import fs from "node:fs/promises";
import path from "node:path";
import { runCommand } from "@/lib/process";
import { ensureProjectFiles, saveProjectConfig, writeProjectFile } from "@/lib/project";

const SAMPLE_TASK = `# Dry Run Task — Finance

## Scenario
A small business owner uploads a CSV of transactions and wants to quickly identify unusual spending patterns before approving the monthly accounts.

## Mandatory requirements
1. Accept a CSV file containing at least: date, description, category, amount.
2. Validate the uploaded file and show a clear error for malformed input.
3. Compute deterministic summary statistics in code:
   - total spend
   - spend by category
   - average transaction amount
   - top 5 largest transactions
4. Flag potentially unusual transactions using a deterministic rule or statistical heuristic. The method must be explained.
5. Use an LLM only to explain the computed findings in plain English. The LLM must not calculate the financial metrics itself.
6. Show one end-to-end results screen containing:
   - summary metrics
   - flagged transactions
   - AI explanation
7. The application must run locally from the repository with documented setup instructions.

## Reliability
- Empty files must be rejected.
- Missing required columns must be rejected.
- Non-numeric amounts must be handled safely.
- The main workflow must not crash on valid input.

## Time box
Treat this as a 60–90 minute practice hackathon.

## Success condition
A reviewer can clone the repo, install dependencies, start the app, upload the provided sample CSV, and reproduce the main result.

## Scope warning
Do not add authentication, a database, payments, user accounts, or unrelated dashboards.
`;

const ACCEPTANCE = `# Acceptance Criteria

## Milestone M1 — Walking skeleton
- [ ] Application boots locally
- [ ] CSV upload UI exists
- [ ] Valid CSV can be parsed
- [ ] Malformed CSV produces a user-facing error
- [ ] Deterministic summary metrics are computed
- [ ] Production build passes

## Later
- [ ] Unusual-transaction detection implemented
- [ ] AI explanation added
- [ ] Result screen completed
- [ ] README documents setup and test workflow
- [ ] Desktop browser evidence captured
- [ ] Mobile browser evidence captured
`;

const STATE = `# Project State

## Current milestone
M1 — Walking skeleton

## Objective
Implement the smallest end-to-end local application that accepts a transaction CSV and computes deterministic summary metrics.

## Working
- Git repository initialized
- Dry-run task seeded

## In progress
- Nothing yet

## Not started
- Application scaffold
- CSV parser
- Summary calculation
- Error handling
- Browser evidence

## Blockers
- None

## Scope
Do not implement anomaly detection or LLM explanation during M1.

## Next action
Codex should implement M1 only and verify the production build.
`;

const ARCHITECTURE = `# Architecture

## V1 decision
Prefer a single local Next.js + TypeScript application unless the implementation agent identifies a task requirement that makes another stack materially better.

## Data flow
CSV upload → validation/parser → deterministic calculations → result UI.

LLM integration is explicitly deferred until a later milestone.

## Constraints
- No database
- No auth
- No cloud dependency for M1
- Calculations must remain deterministic
`;

const SAMPLE_CSV = `date,description,category,amount
2026-09-01,Office rent,Rent,350000
2026-09-02,Cloud hosting,Software,42000
2026-09-03,Coffee meeting,Meals,8500
2026-09-05,Printer supplies,Office,18700
2026-09-06,Taxi to client,Transport,6200
2026-09-08,Annual design software,Software,97000
2026-09-10,Team lunch,Meals,26400
2026-09-11,Emergency equipment repair,Maintenance,188000
2026-09-13,Internet bill,Utilities,21900
2026-09-15,Taxi to airport,Transport,14500
2026-09-16,Client dinner,Meals,44600
2026-09-18,Office chairs,Office,132000
`;

function validateTarget(targetPath: string) {
  if (!path.isAbsolute(targetPath)) throw new Error("Use an absolute folder path.");
  const resolved = path.resolve(targetPath);
  const root = path.parse(resolved).root;
  if (resolved === root) throw new Error("Refusing to initialize a repository at a filesystem root.");
  return resolved;
}

export async function createDryRunRepo(targetPath: string) {
  const resolved = validateTarget(targetPath);
  for (let parent = path.dirname(resolved); ; parent = path.dirname(parent)) {
    if (await fs.stat(path.join(parent, ".git")).catch(() => null)) {
      throw new Error("Dry-run folder cannot be inside another Git repository.");
    }
    if (parent === path.dirname(parent)) break;
  }
  const existing = await fs.stat(resolved).catch(() => null);
  if (existing && !existing.isDirectory()) throw new Error("Target path exists and is not a directory.");
  if (existing) {
    const entries = await fs.readdir(resolved);
    if (entries.length > 0) throw new Error("Dry-run folder must be empty or not exist.");
  } else {
    await fs.mkdir(resolved, { recursive: true });
  }

  const init = await runCommand("git", ["init"], resolved);
  if (init.exitCode !== 0) throw new Error("git init failed: " + (init.stderr || init.stdout));

  await fs.writeFile(path.join(resolved, "README.md"), "# Architect Dry Run\n\nPractice repository generated locally by Architect.\n", "utf8");
  await fs.writeFile(path.join(resolved, ".gitignore"), ".env.local\nnode_modules/\n.next/\n", "utf8");
  await fs.mkdir(path.join(resolved, "sample-data"), { recursive: true });
  await fs.writeFile(path.join(resolved, "sample-data", "transactions.csv"), SAMPLE_CSV, "utf8");

  await saveProjectConfig({ repoPath: resolved });
  await ensureProjectFiles(resolved);
  await writeProjectFile("TASK.md", SAMPLE_TASK);
  await writeProjectFile("ACCEPTANCE.md", ACCEPTANCE);
  await writeProjectFile("PROJECT_STATE.md", STATE);
  await writeProjectFile("ARCHITECTURE.md", ARCHITECTURE);
  await writeProjectFile("DECISIONS.md", "# Decisions\n\n- Dry run initialized from Architect's generic practice template.\n");

  const add = await runCommand("git", ["add", "."], resolved);
  if (add.exitCode !== 0) throw new Error("git add failed: " + (add.stderr || add.stdout));
  const commit = await runCommand("git", ["commit", "-m", "chore: initialize architect dry run"], resolved);

  return {
    repoPath: resolved,
    committed: commit.exitCode === 0,
    commitNote: commit.exitCode === 0 ? "Baseline committed." : "Repository initialized, but baseline commit was skipped. Configure Git user.name/user.email if needed.",
  };
}
