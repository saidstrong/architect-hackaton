import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const ProjectConfigSchema = z.object({
  repoPath: z.string().min(1),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

const appStateDir = path.join(process.cwd(), ".architect-runtime");
const configPath = path.join(appStateDir, "config.json");

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

export async function saveProjectConfig(config: ProjectConfig) {
  const parsed = ProjectConfigSchema.parse(config);
  await ensureDir(appStateDir);
  const stat = await fs.stat(parsed.repoPath).catch(() => null);
  if (!stat?.isDirectory()) throw new Error("Target repository path does not exist.");
  await fs.access(path.join(parsed.repoPath, ".git")).catch(() => {
    throw new Error("Selected folder is not a Git repository.");
  });
  await fs.writeFile(configPath, JSON.stringify(parsed, null, 2), "utf8");
  await ensureProjectFiles(parsed.repoPath);
  return parsed;
}

export async function getProjectConfig(): Promise<ProjectConfig | null> {
  try {
    return ProjectConfigSchema.parse(JSON.parse(await fs.readFile(configPath, "utf8")));
  } catch {
    return null;
  }
}

export async function ensureProjectFiles(repoPath: string) {
  const dir = path.join(repoPath, ".architect");
  await ensureDir(path.join(dir, "reports"));
  await ensureDir(path.join(dir, "evidence"));
  await ensureDir(path.join(dir, "requests"));

  const defaults: Record<string, string> = {
    "TASK.md": "# Task\n\nPaste the official task here.\n",
    "ARCHITECTURE.md": "# Architecture\n\nNot decided yet.\n",
    "PROJECT_STATE.md": "# Project State\n\n## Current milestone\nM0 — Task analysis\n\n## Working\n- Repository selected\n\n## Blockers\n- None\n",
    "ACCEPTANCE.md": "# Acceptance Criteria\n\n- [ ] Official task captured\n",
    "DECISIONS.md": "# Decisions\n",
    "HOURLY_LOG.md": "# Hourly Progress Log\n",
    "reports/latest.md": "# Latest Execution Report\n\nNo execution yet.\n",
  };

  for (const [relative, content] of Object.entries(defaults)) {
    const target = path.join(dir, relative);
    try {
      await fs.access(target);
    } catch {
      await ensureDir(path.dirname(target));
      await fs.writeFile(target, content, "utf8");
    }
  }

  const agentsPath = path.join(repoPath, "AGENTS.md");
  try {
    await fs.access(agentsPath);
  } catch {
    await fs.writeFile(
      agentsPath,
      `# Hackathon Engineering Rules

## Objective
Maximize verified task compliance and evaluation score inside the competition time limit.

## Priority
1. Mandatory task requirements
2. Working end-to-end workflow
3. Technical correctness
4. Reproducibility
5. Reliability and security
6. Documentation
7. Differentiating functionality
8. UI polish

## Scope control
Do not introduce authentication, a database, a new external service, a major framework, a paid resource, or an additional AI-agent layer unless the task requires it or approval is recorded.

## Execution
Work on one milestone at a time. Read .architect/TASK.md, PROJECT_STATE.md, ACCEPTANCE.md, ARCHITECTURE.md, and DECISIONS.md before implementation.

If a secret is required, create .architect/requests/secret-<NAME>.json with:
{"type":"secret","name":"<NAME>","reason":"why it is needed","required":true}

If a major architecture or external-service decision is required, create .architect/requests/approval-<short-name>.json describing the decision and expected benefit/cost.

Never invent credentials. Never write secret values into markdown, logs, screenshots, or Git history.

Before declaring a milestone complete, run relevant tests and update .architect/PROJECT_STATE.md and .architect/reports/latest.md with factual results only.

Do not start the next milestone automatically.
`,
      "utf8"
    );
  }

  const ignorePath = path.join(repoPath, ".gitignore");
  let ignore = "";
  try { ignore = await fs.readFile(ignorePath, "utf8"); } catch {}
  const additions = [".env.local", ".architect/runtime/"];
  const lines = new Set(ignore.split(/\r?\n/).filter(Boolean));
  for (const item of additions) lines.add(item);
  await fs.writeFile(ignorePath, Array.from(lines).join("\n") + "\n", "utf8");
}

export async function readProjectFile(relative: string, repoPath?: string) {
  const selected = repoPath || (await getProjectConfig())?.repoPath;
  if (!selected) return null;
  const full = path.join(selected, ".architect", relative);
  return fs.readFile(full, "utf8").catch(() => null);
}

export async function writeProjectFile(relative: string, content: string, repoPath?: string) {
  const selected = repoPath || (await getProjectConfig())?.repoPath;
  if (!selected) throw new Error("No project selected.");
  const base = path.join(selected, ".architect");
  const full = path.resolve(base, relative);
  if (!full.startsWith(path.resolve(base) + path.sep)) throw new Error("Invalid architect file path.");
  await ensureDir(path.dirname(full));
  await fs.writeFile(full, content, "utf8");
}
