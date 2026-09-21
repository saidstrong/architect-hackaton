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
}

export async function readProjectFile(relative: string) {
  const config = await getProjectConfig();
  if (!config) return null;
  const full = path.join(config.repoPath, ".architect", relative);
  return fs.readFile(full, "utf8").catch(() => null);
}

export async function writeProjectFile(relative: string, content: string) {
  const config = await getProjectConfig();
  if (!config) throw new Error("No project selected.");
  const base = path.join(config.repoPath, ".architect");
  const full = path.resolve(base, relative);
  if (!full.startsWith(path.resolve(base) + path.sep)) throw new Error("Invalid architect file path.");
  await ensureDir(path.dirname(full));
  await fs.writeFile(full, content, "utf8");
}
