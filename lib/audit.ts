import fs from "node:fs/promises";
import path from "node:path";
import { getProjectConfig, readProjectFile, writeProjectFile } from "@/lib/project";
import { getGitStatus } from "@/lib/git";
import { runVerification, type VerificationCheck } from "@/lib/verify";

export async function runAudit() {
  const config = await getProjectConfig();
  if (!config) throw new Error("No project selected.");

  const checks: VerificationCheck[] = [];
  const verification = await runVerification(config.repoPath);
  checks.push(...verification.checks);

  const requiredDocs = ["TASK.md","ARCHITECTURE.md","PROJECT_STATE.md","ACCEPTANCE.md","DECISIONS.md","reports/latest.md"];
  for (const file of requiredDocs) {
    const content = await readProjectFile(file);
    checks.push({ name: `Document: ${file}`, ok: Boolean(content && content.trim().length > 20), detail: content ? undefined : "Missing." });
  }

  const readme = await fs.readFile(path.join(config.repoPath,"README.md"),"utf8").catch(() => "");
  checks.push({ name:"README", ok: readme.trim().length > 200, detail: readme.trim().length > 200 ? undefined : "README is missing or too thin." });

  const git = await getGitStatus();
  checks.push({ name:"Git repository", ok: Boolean(git), detail: git ? `${git.status.length} uncommitted path(s).` : "Git unavailable." });

  const envExample = await fs.readFile(path.join(config.repoPath,".env.example"),"utf8").catch(() => "");
  const envLocal = await fs.readFile(path.join(config.repoPath,".env.local"),"utf8").catch(() => "");
  const localNames = envLocal.split(/\r?\n/).map((l) => l.split("=")[0]).filter(Boolean);
  const documentedNames = new Set(envExample.split(/\r?\n/).map((l) => l.split("=")[0]).filter(Boolean));
  const undocumented = localNames.filter((name) => !documentedNames.has(name));
  checks.push({ name:"Environment documentation", ok: undocumented.length === 0, detail: undocumented.length ? `Undocumented: ${undocumented.join(", ")}` : undefined });

  const result = { ok: checks.every((c) => c.ok), checks, generatedAt: new Date().toISOString() };
  await writeProjectFile("reports/audit-latest.md", [
    "# Final Audit",
    "",
    `Generated: ${result.generatedAt}`,
    `Result: ${result.ok ? "ready" : "blocked"}`,
    "",
    ...checks.map((check) => `- [${check.ok ? "x" : " "}] ${check.name}${check.detail ? " — " + check.detail : ""}`),
    "",
  ].join("\n"), config.repoPath);
  return result;
}
