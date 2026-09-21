import { getProjectConfig } from "@/lib/project";
import { runCommand } from "@/lib/process";

export async function getGitStatus() {
  const config = await getProjectConfig();
  if (!config) return null;
  const [status, log, diff] = await Promise.all([
    runCommand("git", ["status", "--short"], config.repoPath),
    runCommand("git", ["log", "-8", "--pretty=format:%h|%ad|%s", "--date=short"], config.repoPath),
    runCommand("git", ["diff", "--stat"], config.repoPath),
  ]);
  return {
    status: status.stdout.trim().split(/\r?\n/).filter(Boolean),
    commits: log.stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => {
      const [sha,date,...message] = line.split("|");
      return { sha,date,message:message.join("|") };
    }),
    diffStat: diff.stdout.trim(),
  };
}
