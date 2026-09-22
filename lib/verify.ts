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
  const result = await runCommand("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], repoPath);
  if (result.exitCode !== 0) return { name: "Secret scan", ok: false, detail: "Could not list Git-trackable files." };
  const secretPattern = /(sk-[A-Za-z0-9_-]{12,}|(?:api[_-]?key|secret|token)\s*[=:]\s*["']?[A-Za-z0-9_\-]{12,})/i;
  let checked = 0;
  for (const file of result.stdout.split("\0").filter(Boolean)) {
    const fullPath = path.join(repoPath, file);
    try {
      if (!(await fs.lstat(fullPath)).isFile()) continue;
      checked++;
      if (secretPattern.test(await fs.readFile(fullPath, "utf8"))) {
        return { name: "Secret scan", ok: false, detail: "Potential secret detected in a Git-trackable file." };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      return { name: "Secret scan", ok: false, detail: "Could not inspect a Git-trackable file." };
    }
  }
  return { name: "Secret scan", ok: true, detail: `Scanned ${checked} Git-trackable file(s).` };
}

export async function runVerification(repoPath: string) {
  const project = await packageScripts(repoPath);
  const checks: VerificationCheck[] = [];

  const runScript = async (name: string) => {
    if (!project?.scripts[name]) {
      checks.push({ name, ok: true, detail: "No script configured; skipped." });
      return;
    }
    // Architect runs in development mode, but the target build must run with
    // Next's production environment rather than inheriting the dev server's.
    const r = await runCommand("npm", ["run", name], repoPath, name === "build" ? { NODE_ENV: "production" } : undefined);
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
