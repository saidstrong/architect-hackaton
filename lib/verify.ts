import fs from "node:fs/promises";
import path from "node:path";
import { runCommand } from "@/lib/process";

export type VerificationCheck = { name: string; ok: boolean; detail?: string };

async function packageScripts(repoPath: string): Promise<Record<string,string>> {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(repoPath, "package.json"), "utf8"));
    return pkg.scripts || {};
  } catch {
    return {};
  }
}

async function gitSecretCheck(repoPath: string): Promise<VerificationCheck> {
  const result = await runCommand("git", ["diff", "--cached", "--", "."], repoPath);
  const risky = /(sk-[A-Za-z0-9_-]{12,}|(?:api[_-]?key|secret|token)\s*[=:]\s*["']?[A-Za-z0-9_\-]{12,})/i.test(result.stdout);
  return { name: "Secret scan", ok: result.exitCode === 0 && !risky, detail: risky ? "Potential secret detected in staged diff." : undefined };
}

export async function runVerification(repoPath: string) {
  const scripts = await packageScripts(repoPath);
  const checks: VerificationCheck[] = [];

  const runScript = async (name: string) => {
    if (!scripts[name]) {
      checks.push({ name, ok: true, detail: "No script configured; skipped." });
      return;
    }
    const r = await runCommand("npm", ["run", name], repoPath);
    checks.push({
      name,
      ok: r.exitCode === 0,
      detail: r.exitCode === 0 ? `Passed in ${Math.round(r.durationMs/1000)}s.` : (r.stderr || r.stdout).slice(-500),
    });
  };

  await runScript("typecheck");
  await runScript("test");
  await runScript("build");
  checks.push(await gitSecretCheck(repoPath));

  return { ok: checks.every((c) => c.ok), checks };
}
