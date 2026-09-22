export type ReportCheck = { name: string; ok: boolean; skipped: boolean; detail: string };

export function markdownSection(markdown: string, heading: string) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`^## ${escaped}\\s*\\r?\\n([\\s\\S]*?)(?=^## |$)`, "im"));
  return match?.[1]?.trim() || "";
}

export function parseMilestone(state: string, acceptance: string) {
  const title = markdownSection(state, "Current milestone").split(/\r?\n/)[0] || "Milestone not specified";
  const objective = markdownSection(state, "Objective").split(/\r?\n/)[0] || "Add an objective in PROJECT_STATE.md.";
  const next = markdownSection(state, "Next action").split(/\r?\n/)[0] || "";
  const number = title.match(/\bM\d+\b/i)?.[0]?.toUpperCase();
  const sections = acceptance.split(/^## /m).slice(1);
  const selected = number ? sections.find(value => new RegExp(`\\b${number}\\b`, "i").test(value.split(/\r?\n/)[0])) : undefined;
  const source = selected || (sections.length ? "" : acceptance);
  const criteria = [...source.matchAll(/^- \[([ xX])\] (.+)$/gm)].map(match => ({ done: match[1].toLowerCase() === "x", label: match[2].trim() }));
  return { title, objective, next, criteria, done: criteria.filter(item => item.done).length, total: criteria.length };
}

export function parseReport(markdown: string): ReportCheck[] {
  return [...markdown.matchAll(/^- \[([ xX])\] ([^\r\n]+)$/gm)].map(match => {
    const [name, ...detail] = match[2].split(" — ");
    const explanation = detail.join(" — ");
    return { name: name.trim(), ok: match[1].toLowerCase() === "x", skipped: /skipped|no script configured/i.test(explanation), detail: explanation };
  });
}

export function timerDisplay(startedAt: string, endsAt: string, now: number) {
  const start = Date.parse(startedAt);
  const end = Date.parse(endsAt);
  const duration = Math.max(1, end - start);
  const remaining = Math.max(0, end - now);
  const elapsed = Math.max(0, now - start);
  const seconds = Math.ceil(remaining / 1000);
  const clock = [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60].map(value => String(value).padStart(2, "0")).join(":");
  const phase = remaining === 0 ? "COMPLETE" : elapsed < duration * .6 ? "BUILD" : elapsed < duration * .8 ? "STABILIZE" : elapsed < duration * .9 ? "DOCUMENT" : "SUBMIT";
  const warning = remaining === 0 ? "Time is up. Review the final audit and submission requirements." : remaining <= 30 * 60_000 ? "SUBMISSION MODE · Run final audit and avoid architecture changes." : remaining <= 60 * 60_000 ? "Feature freeze recommended. Prioritize reliability and documentation." : remaining <= 120 * 60_000 ? "Focus on the core workflow. Avoid new infrastructure." : "";
  return { clock, phase, warning, expired: remaining === 0 };
}
