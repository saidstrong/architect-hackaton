import fs from "node:fs/promises";
import path from "node:path";
import { runCommand } from "@/lib/process";

export type VerificationCheck = { name: string; ok: boolean; detail?: string };

async function packageScripts(repoPath: string): Promise<{ scripts: Record<string,string>; manager: string } | null> {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(repoPath, "package.json"), "utf8"));
    let manager = typeof pkg.packageManager === "string" ? pkg.packageManager.split("@")[0] : "npm";
    if (!pkg.packageManager) {
      if (await fs.stat(path.join(repoPath, "pnpm-lock.yaml")).then(() => true, () => false)) manager = "pnpm";
      else if (await fs.stat(path.join(repoPath, "yarn.lock")).then(() => true, () => false)) manager = "yarn";
    }
    return { scripts: pkg.scripts || {}, manager };
  } catch {
    return null;
  }
}

async function gitSecretCheck(repoPath: string): Promise<VerificationCheck> {
  const result = await runCommand("git", ["diff", "--cached", "--", "."], repoPath);
  const risky = /(sk-[A-Za-z0-9_-]{12,}|(?:api[_-]?key|secret|token)\s*[=:]\s*["']?[A-Za-z0-9_\-]{12,})/i.test(result.stdout);
  return { name: "Secret scan", ok: result.exitCode === 0 && !risky, detail: risky ? "Potential secret detected in staged diff." : undefined };
}

export async function runVerification(repoPath: string) {
  const project = await packageScripts(repoPath);
  const checks: VerificationCheck[] = [];

  const runScript = async (name: string) => {
    if (!project?.scripts[name]) {
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

  if (!project) {
    checks.push({ name: "Project verification", ok: false, detail: "No readable package.json; configure verification for this project before treating it as ready." });
  } else if (project.manager !== "npm") {
    checks.push({ name: "Project verification", ok: false, detail: `${project.manager} projects are not yet supported by automatic verification.` });
  } else if (!project.scripts.typecheck && !project.scripts.test && !project.scripts.build) {
    checks.push({ name: "Project verification", ok: false, detail: "No typecheck, test, or build script is configured." });
  } else {
    await runScript("typecheck");
    await runScript("test");
    await runScript("build");
  }
  checks.push(await gitSecretCheck(repoPath));

  return { ok: checks.every((c) => c.ok), checks };
}
