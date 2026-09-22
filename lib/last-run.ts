import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type LastRun = {
  repoPath: string;
  startedAt: string;
  finishedAt: string;
  codexExitCode: number | null;
  verificationPassed: boolean;
  status: "passed" | "failed";
  mode?: "milestone" | "fix";
  finalMessage: string;
};

const lastRunPath = path.join(process.cwd(), ".architect-runtime", "last-run.json");

export function sameRepo(a: string, b: string) {
  const normalize = (value: string) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
  return normalize(a) === normalize(b);
}

export async function readLastRun(repoPath: string): Promise<LastRun | null> {
  try {
    const value: unknown = JSON.parse(await fs.readFile(lastRunPath, "utf8"));
    if (!value || typeof value !== "object") return null;
    const run = value as Partial<LastRun>;
    if (typeof run.repoPath !== "string" || !sameRepo(run.repoPath, repoPath) ||
        typeof run.startedAt !== "string" || typeof run.finishedAt !== "string" ||
        (run.codexExitCode !== null && typeof run.codexExitCode !== "number") ||
        typeof run.verificationPassed !== "boolean" ||
        (run.status !== "passed" && run.status !== "failed") ||
        typeof run.finalMessage !== "string" ||
        (run.mode !== undefined && run.mode !== "milestone" && run.mode !== "fix")) return null;
    return run as LastRun;
  } catch {
    return null;
  }
}

export async function writeLastRun(run: LastRun) {
  await fs.mkdir(path.dirname(lastRunPath), { recursive: true });
  const temporary = `${lastRunPath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify(run, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
    await fs.rename(temporary, lastRunPath);
  } catch (error) {
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
}
