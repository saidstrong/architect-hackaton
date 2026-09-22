"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { parseMilestone, parseReport, timerDisplay } from "@/lib/ui-summary";
import type { ChangeProposal, ChangeStatus } from "@/lib/changes";
import type { HackathonTimer } from "@/lib/hackathon-timer";

type Config = { repoPath: string } | null;
type Activity = { at: string; kind: string; message: string };
type Execution = { running: boolean; blocked?: boolean; startedAt: string|null; finishedAt: string|null; exitCode: number|null; verificationOk?: boolean|null; status?: "passed"|"failed"|null; mode?:"milestone"|"fix"; activities: Activity[]; finalMessage: string|null };
type GitState = { branch:string; head:string; status:string[]; commits:{sha:string;date:string;message:string}[]; diffStat:string } | null;
type RequestItem = { file:string; type:string; name?:string; reason?:string; required?:boolean; [key:string]:unknown };
type Evidence = { id:string; image:string; createdAt:string; url:string; viewport:{width:number;height:number}; title?:string; consoleErrors:string[]; failedRequests:string[] };
type Audit = { ok:boolean; generatedAt:string; checks:{name:string;ok:boolean;detail?:string}[] };
type View = "Overview" | "Requirements" | "Changes" | "Evidence" | "Git" | "Audit";
const NAV: View[] = ["Overview", "Requirements", "Changes", "Evidence", "Git", "Audit"];
const EDITABLE = ["TASK.md", "ACCEPTANCE.md", "ARCHITECTURE.md", "PROJECT_STATE.md", "DECISIONS.md", "HOURLY_LOG.md"];
const REPORTS = ["reports/latest.md", "reports/codex-latest.md", "reports/verification-latest.md", "reports/audit-latest.md"];
const EMPTY_EXECUTION: Execution = { running:false, startedAt:null, finishedAt:null, exitCode:null, activities:[], finalMessage:null };

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "content-type":"application/json", ...(init?.headers || {}) }, cache:"no-store" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}
async function readFile(file: string) {
  return (await jsonFetch<{content:string|null}>(`/api/state?file=${encodeURIComponent(file)}`)).content || "";
}
function timeLabel(value: string | null | undefined) {
  return value ? new Date(value).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit", second:"2-digit" }) : "—";
}
function projectName(repoPath: string) { return repoPath.split(/[\\/]/).filter(Boolean).at(-1) || repoPath; }
function errorText(error: unknown) { return error instanceof Error ? error.message : "Request failed."; }
function isArchitectCapture(url: string) {
  if (typeof window === "undefined") return false;
  try {
    const captured = new URL(url);
    const current = new URL(window.location.href);
    const loopback = (host: string) => host === "localhost" || host === "127.0.0.1";
    return captured.port === current.port && captured.protocol === current.protocol &&
      (captured.hostname === current.hostname || (loopback(captured.hostname) && loopback(current.hostname)));
  } catch { return false; }
}

export default function Home() {
  const [config, setConfig] = useState<Config>(null);
  const [repoPath, setRepoPath] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("Overview");
  const [execution, setExecution] = useState<Execution>(EMPTY_EXECUTION);
  const [git, setGit] = useState<GitState>(null);
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [documents, setDocuments] = useState({ state:"", acceptance:"", verification:"", audit:"" });
  const [activeFile, setActiveFile] = useState("TASK.md");
  const [fileContent, setFileContent] = useState("");
  const [fileDirty, setFileDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [secretValues, setSecretValues] = useState<Record<string,string>>({});
  const [captureUrl, setCaptureUrl] = useState("http://localhost:3001");
  const [captureSize, setCaptureSize] = useState("1440x900");
  const [capturing, setCapturing] = useState(false);
  const [audit, setAudit] = useState<Audit|null>(null);
  const [auditing, setAuditing] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [creatingDryRun, setCreatingDryRun] = useState(false);
  const [timer, setTimer] = useState<HackathonTimer|null>(null);
  const [durationHours, setDurationHours] = useState(5);
  const [now, setNow] = useState(() => Date.now());
  const [changes, setChanges] = useState<ChangeProposal[]>([]);
  const [idea, setIdea] = useState("");
  const [proposing, setProposing] = useState(false);
  const [deciding, setDeciding] = useState("");
  const [fullActivity, setFullActivity] = useState(false);

  const refreshLive = useCallback(async () => {
    const [execData, gitData, reqData, evidenceData] = await Promise.all([
      jsonFetch<Execution>("/api/execution"), jsonFetch<{git:GitState}>("/api/git"),
      jsonFetch<{requests:RequestItem[]}>("/api/requests"), jsonFetch<{evidence:Evidence[]}>("/api/evidence"),
    ]);
    setExecution(execData); setGit(gitData.git); setRequests(reqData.requests); setEvidence(evidenceData.evidence);
  }, []);
  const refreshContext = useCallback(async () => {
    const [state, acceptance, verification, auditReport, timerData, changeData] = await Promise.all([
      readFile("PROJECT_STATE.md"), readFile("ACCEPTANCE.md"), readFile("reports/verification-latest.md"), readFile("reports/audit-latest.md"),
      jsonFetch<{timer:HackathonTimer|null}>("/api/timer"), jsonFetch<{changes:ChangeProposal[]}>("/api/changes"),
    ]);
    setDocuments({ state, acceptance, verification, audit:auditReport });
    setTimer(timerData.timer); setChanges(changeData.changes);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const data = await jsonFetch<{config:Config}>("/api/project");
        setConfig(data.config);
        if (data.config) { setRepoPath(data.config.repoPath); await Promise.all([refreshLive(), refreshContext(), readFile("TASK.md").then(setFileContent)]); }
      } catch (cause) { setError(errorText(cause)); }
      finally { setLoading(false); }
    })();
  }, [refreshLive, refreshContext]);
  useEffect(() => {
    if (!config) return;
    const id = window.setInterval(() => { refreshLive().catch(() => {}); }, execution.running ? 1200 : 4000);
    return () => window.clearInterval(id);
  }, [config, execution.running, refreshLive]);
  useEffect(() => {
    if (!config) return;
    const id = window.setInterval(() => { setNow(Date.now()); }, 1000);
    return () => window.clearInterval(id);
  }, [config]);
  useEffect(() => { if (config && execution.finishedAt) refreshContext().catch(() => {}); }, [config, execution.finishedAt, refreshContext]);

  async function selectProject(create: boolean) {
    setError(""); setCreatingDryRun(create);
    try {
      if (create) {
        const data = await jsonFetch<{result:{repoPath:string}}>("/api/dry-run", { method:"POST", body:JSON.stringify({ repoPath }) });
        setConfig({ repoPath:data.result.repoPath }); setRepoPath(data.result.repoPath);
      } else {
        const data = await jsonFetch<{config:Config}>("/api/project", { method:"POST", body:JSON.stringify({ repoPath }) });
        setConfig(data.config);
      }
      await Promise.all([refreshLive(), refreshContext(), readFile("TASK.md").then(setFileContent)]);
      setView("Overview"); setActiveFile("TASK.md"); setFileDirty(false); setAudit(null);
    } catch (cause) { setError(errorText(cause)); }
    finally { setCreatingDryRun(false); }
  }
  function chooseAnotherProject() {
    if (fileDirty && !confirm("Discard unsaved changes?")) return;
    setConfig(null); setRepoPath(""); setExecution(EMPTY_EXECUTION); setGit(null); setRequests([]); setEvidence([]);
    setTimer(null); setChanges([]); setAudit(null); setError("");
  }
  async function changeFile(file: string) {
    if (fileDirty && !confirm("Discard unsaved changes?")) return;
    try { const content = await readFile(file); setActiveFile(file); setFileContent(content); setFileDirty(false); }
    catch (cause) { setError(errorText(cause)); }
  }
  async function saveFile() {
    setSaving(true); setError("");
    try { await jsonFetch("/api/state", { method:"POST", body:JSON.stringify({ file:activeFile, content:fileContent }) }); setFileDirty(false); await refreshContext(); }
    catch (cause) { setError(errorText(cause)); }
    finally { setSaving(false); }
  }
  async function runMilestone(mode: "milestone" | "fix" = "milestone") {
    setError("");
    try { setExecution(await jsonFetch<Execution>("/api/execution", { method:"POST", body:JSON.stringify({ mode }) })); }
    catch (cause) { setError(errorText(cause)); }
  }
  async function runVerificationNow() {
    setVerifying(true); setError("");
    try { await jsonFetch("/api/verification", { method:"POST" }); await refreshContext(); if (activeFile === "reports/verification-latest.md") setFileContent(await readFile(activeFile)); }
    catch (cause) { setError(errorText(cause)); }
    finally { setVerifying(false); }
  }
  async function startTimer() {
    setError("");
    try { const data = await jsonFetch<{timer:HackathonTimer}>("/api/timer", { method:"POST", body:JSON.stringify({ durationHours }) }); setTimer(data.timer); setNow(Date.now()); }
    catch (cause) { setError(errorText(cause)); }
  }
  async function propose() {
    setProposing(true); setError("");
    try { await jsonFetch("/api/changes", { method:"POST", body:JSON.stringify({ action:"propose", text:idea }) }); setIdea(""); await refreshContext(); setView("Changes"); }
    catch (cause) { setError(errorText(cause)); }
    finally { setProposing(false); }
  }
  async function decide(id: string, status: Exclude<ChangeStatus, "Pending">) {
    setDeciding(id); setError("");
    try { await jsonFetch("/api/changes", { method:"POST", body:JSON.stringify({ action:"decide", id, status }) }); await refreshContext(); }
    catch (cause) { setError(errorText(cause)); }
    finally { setDeciding(""); }
  }
  async function saveSecret(req: RequestItem) {
    if (!req.name) return;
    try {
      await jsonFetch("/api/secrets", { method:"POST", body:JSON.stringify({ name:req.name, value:secretValues[req.file] || "" }) });
      await jsonFetch("/api/requests", { method:"DELETE", body:JSON.stringify({ file:req.file }) });
      setSecretValues(old => ({ ...old, [req.file]:"" })); await refreshLive();
    } catch (cause) { setError(errorText(cause)); }
  }
  async function resolveRequest(req: RequestItem) {
    try { await jsonFetch("/api/requests", { method:"DELETE", body:JSON.stringify({ file:req.file }) }); await refreshLive(); }
    catch (cause) { setError(errorText(cause)); }
  }
  async function capture() {
    setCapturing(true); setError("");
    try { const [width, height] = captureSize.split("x").map(Number); await jsonFetch("/api/evidence", { method:"POST", body:JSON.stringify({ url:captureUrl, width, height, title:"Manual browser review" }) }); await refreshLive(); }
    catch (cause) { setError(errorText(cause)); }
    finally { setCapturing(false); }
  }
  async function runAuditNow() {
    setAuditing(true); setError("");
    try { const data = await jsonFetch<{audit:Audit}>("/api/audit", { method:"POST" }); setAudit(data.audit); await refreshContext(); if (activeFile === "reports/audit-latest.md") setFileContent(await readFile(activeFile)); }
    catch (cause) { setError(errorText(cause)); }
    finally { setAuditing(false); }
  }

  const milestone = useMemo(() => parseMilestone(documents.state, documents.acceptance), [documents.state, documents.acceptance]);
  const verification = useMemo(() => parseReport(documents.verification), [documents.verification]);
  const auditChecks = audit?.checks || parseReport(documents.audit);
  const auditReady = audit ? audit.ok : /Result: ready/i.test(documents.audit);
  const clock = timer ? timerDisplay(timer.startedAt, timer.endsAt, now) : null;
  const failed = verification.filter(check => !check.ok);
  const runPassed = execution.status === "passed";
  const targetEvidence = evidence.filter(item => !isArchitectCapture(item.url));
  const latestDesktop = targetEvidence.find(item => item.viewport.width >= 1000);
  const latestMobile = targetEvidence.find(item => item.viewport.width < 600);
  const action = requests.length ? { tone:"attention", label:"ACTION REQUIRED", title:requests[0].type === "secret" ? `${requests[0].name || "A secret"} is required` : "Decision required", detail:requests[0].reason || "Review the pending request.", button:"Review request", go:() => document.getElementById("requests")?.scrollIntoView({ behavior:"smooth" }) }
    : execution.blocked ? { tone:"attention", label:"RECOVERY REQUIRED", title:"Previous execution appears incomplete", detail:execution.finalMessage || "Inspect the lock and process before recovery.", button:"View details", go:() => { setFullActivity(true); document.getElementById("activity")?.scrollIntoView({ behavior:"smooth" }); } }
    : execution.running ? { tone:"working", label:"NO ACTION REQUIRED", title:"Codex is working", detail:`Implementing ${milestone.title}.`, button:"View activity", go:() => document.getElementById("activity")?.scrollIntoView({ behavior:"smooth" }) }
    : failed.length ? { tone:"failure", label:"MILESTONE BLOCKED", title:`${failed[0].name} failed`, detail:failed[0].detail || "Deterministic verification failed.", button:"Fix with Codex", go:() => runMilestone("fix") }
    : execution.status === "failed" ? { tone:"failure", label:"RUN NEEDS REVIEW", title:"Codex run did not pass", detail:execution.finalMessage || "Review the activity and verification report.", button:"View activity", go:() => { setFullActivity(true); document.getElementById("activity")?.scrollIntoView({ behavior:"smooth" }); } }
    : runPassed && execution.mode === "fix" ? { tone:"success", label:"VERIFICATION RESTORED", title:"Review milestone acceptance", detail:execution.finalMessage || "Checks pass after the scoped repair. Review the milestone before proceeding.", button:"Review requirements", go:() => setView("Requirements") }
    : runPassed ? { tone:"success", label:"MILESTONE PASSED", title:"Review results and plan the next milestone", detail:milestone.next || "Verification passed. Decide the next step explicitly.", button:"Review requirements", go:() => setView("Requirements") }
    : { tone:"neutral", label:"READY FOR ACTION", title:"Start the current milestone", detail:milestone.next || "Review requirements before starting Codex.", button:"Run milestone", go:() => runMilestone() };

  if (loading) return <main className="center-screen"><div className="loader"/><p>Opening Architect…</p></main>;
  if (!config) return <main className="setup-shell"><section className="setup-card">
    <div className="eyebrow">LOCAL HACKATHON CONTROL</div><h1>Architect</h1>
    <p className="muted">Connect a local Git repository to see the active milestone, execution state, project health, and next action.</p>
    <label htmlFor="repo-path">Target repository path</label><input id="repo-path" value={repoPath} onChange={event => setRepoPath(event.target.value)} placeholder="C:\Users\Said\Projects\hackalem-project"/>
    <div className="setup-actions"><button className="primary" onClick={() => selectProject(false)} disabled={!repoPath.trim() || creatingDryRun}>Connect repository</button><button className="secondary" onClick={() => selectProject(true)} disabled={!repoPath.trim() || creatingDryRun}>{creatingDryRun ? "Creating…" : "Create Finance dry run"}</button></div>
    {error && <div className="error-box">{error}</div>}
    <p className="micro">Connect expects an existing Git repository. Finance dry run initializes a practice repository in an empty folder.</p>
  </section></main>;

  return <main className="app-shell">
    <header className="topbar">
      <div className="top-identity"><div className="brand-row"><span className="brand-mark">A</span><strong>ARCHITECT</strong><span className="local-badge">LOCAL</span></div><div className="project-identity" title={config.repoPath}><strong>{projectName(config.repoPath)}</strong><span>{git?.branch || "—"} <b>·</b> {git?.head || "—"}</span></div></div>
      <div className="top-status"><div className="timer-top">{clock ? <><strong>{clock.clock}</strong><span>{clock.expired ? "TIME UP" : "LEFT"} · {clock.phase}</span></> : <button className="text-button" onClick={() => document.getElementById("timer-setup")?.scrollIntoView({ behavior:"smooth" })}>Start hackathon timer</button>}</div><span className={`status-pill ${execution.running ? "working" : execution.blocked ? "blocked" : "ready"}`}><i/>{execution.running ? "CODEX WORKING" : execution.blocked ? "RECOVERY REQUIRED" : execution.status === "failed" ? "LAST RUN FAILED" : "CODEX IDLE"}</span></div>
    </header>
    <nav className="primary-nav" aria-label="Primary navigation">{NAV.map(item => <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}>{item}{item === "Changes" && changes.filter(c => c.status === "Pending").length > 0 && <span className="nav-count">{changes.filter(c => c.status === "Pending").length}</span>}</button>)}<button className="nav-project" onClick={chooseAnotherProject} disabled={execution.running || execution.blocked || auditing}>Change project</button></nav>
    {error && <div className="global-error" role="alert">{error}<button aria-label="Dismiss error" onClick={() => setError("")}>×</button></div>}

    {view === "Overview" && <div className="view-content overview">
      <div className="overview-heading"><div><span className="eyebrow">MISSION CONTROL</span><h1>Overview</h1><p>Current state and the next decision for this project.</p></div><button className="secondary" onClick={runVerificationNow} disabled={verifying || auditing || execution.running || execution.blocked}>{verifying ? "Verifying…" : "Run verification"}</button></div>
      {clock?.warning && <div className={`time-warning ${clock.expired || clock.phase === "SUBMIT" ? "urgent" : ""}`}><strong>{clock.phase}</strong><span>{clock.warning}</span></div>}
      <div className="hero-grid">
        <section className="mission-card milestone-card"><div className="card-kicker"><span>CURRENT MILESTONE</span><span>{milestone.total ? `${milestone.done} / ${milestone.total} acceptance` : "Acceptance not structured"}</span></div><h2>{milestone.title}</h2><p className="milestone-objective">{milestone.objective}</p><div className="milestone-criteria">{milestone.criteria.length ? milestone.criteria.slice(0, 6).map((criterion, index) => <div key={index} className={criterion.done ? "criterion done" : "criterion"}><span>{criterion.done ? "✓" : "○"}</span><p>{criterion.label}</p></div>) : <p className="muted">Add milestone criteria to ACCEPTANCE.md.</p>}</div>{milestone.criteria.length > 6 && <span className="micro">+ {milestone.criteria.length - 6} more in Requirements</span>}</section>
        <section className={`mission-card action-card ${action.tone}`}><div className="card-kicker"><span>NEXT ACTION</span><span className="state-indicator">{action.label}</span></div><h2>{action.title}</h2><p>{action.detail}</p><div className="action-bottom"><button className="primary" onClick={action.go} disabled={verifying || auditing || Boolean(deciding)}>{action.button}</button>{action.label === "MILESTONE BLOCKED" && <button className="text-button" onClick={() => { setView("Requirements"); changeFile("reports/verification-latest.md"); }}>View details</button>}{action.label === "READY FOR ACTION" && <button className="text-button" onClick={() => setView("Requirements")}>Review requirements</button>}</div></section>
      </div>
      {requests.length > 0 && <section className="mission-card request-section" id="requests"><div className="card-kicker"><span>HUMAN INPUT</span><span>{requests.length} request{requests.length === 1 ? "" : "s"}</span></div><div className="request-list">{requests.map(req => <div className="request-card" key={req.file}><div><span className="request-type">{req.type.toUpperCase()}</span><h3>{req.name || "Architecture decision"}</h3><p>{req.reason || "Review this request before resolving it."}</p></div>{req.type === "secret" ? <div className="request-controls"><input aria-label={`Value for ${req.name}`} type="password" autoComplete="off" placeholder={`Paste ${req.name || "secret"}`} value={secretValues[req.file] || ""} onChange={event => setSecretValues(old => ({ ...old, [req.file]:event.target.value }))}/><button className="primary compact" onClick={() => saveSecret(req)} disabled={!secretValues[req.file]?.trim()}>Save & resolve</button><small>Stored only in the target&apos;s local .env.local.</small></div> : <button className="secondary compact" onClick={() => resolveRequest(req)}>Mark resolved</button>}</div>)}</div></section>}
      <div className="support-grid">
        <section className="mission-card" id="activity"><div className="card-kicker"><span>LIVE ACTIVITY</span><button className="text-button" onClick={() => setFullActivity(value => !value)}>{fullActivity ? "Show less" : "View full activity"}</button></div><div className="activity-stream">{execution.finalMessage && <div className={`run-summary ${runPassed ? "pass" : "fail"}`}>{execution.finalMessage}</div>}{execution.activities.length ? [...execution.activities].reverse().slice(0, fullActivity ? 100 : 5).map((item, index) => <div className="activity-row" key={`${item.at}-${index}`}><time>{timeLabel(item.at)}</time><span className={`activity-dot ${item.kind}`}/><p>{item.message}</p></div>) : <Empty text={execution.finishedAt ? "Previous run activity is unavailable after restart. See persisted reports in Requirements." : "No execution yet. Activity appears here when Codex runs."}/>}</div></section>
        <section className="mission-card"><div className="card-kicker"><span>PROJECT HEALTH</span><span>{documents.verification ? `Checked ${timeLabel(documents.verification.match(/Generated: ([^\n]+)/)?.[1])}` : "Not verified"}</span></div><div className="health-list">{["typecheck", "test", "build", "Browser", "Secret scan"].map(name => { const check = verification.find(item => item.name.toLowerCase() === name.toLowerCase()); const isBrowser = name === "Browser"; const browserErrors = targetEvidence.length ? targetEvidence[0].consoleErrors.length + targetEvidence[0].failedRequests.length : 0; const tone = isBrowser ? !targetEvidence.length ? "neutral" : browserErrors ? "failure" : "success" : !check || check.skipped ? "neutral" : check.ok ? "success" : "failure"; return <div className="health-row" key={name}><span>{name === "test" ? "Tests" : name === "build" ? "Build" : name === "typecheck" ? "Typecheck" : name === "Secret scan" ? "Secrets" : name}</span><strong className={tone}>{isBrowser ? !targetEvidence.length ? "Not captured" : browserErrors ? `${browserErrors} issue(s) in last capture` : "Last capture clean" : !check ? "Not run" : check.skipped ? "Skipped" : check.ok ? "Passed" : "Failed"}</strong></div>; })}</div><div className="health-footer"><span>{targetEvidence.length ? `${targetEvidence.length} target capture(s)` : "Browser checks need a target capture"}</span><button className="text-button" onClick={() => setView("Evidence")}>View evidence →</button></div></section>
      </div>
      <section className="mission-card idea-card"><div><span className="card-kicker">CHANGE DIRECTION</span><h2>Have a new idea?</h2><p>Evaluate it for later work. The current milestone stays in place.</p></div><div className="idea-controls"><textarea aria-label="Idea or direction change" value={idea} onChange={event => setIdea(event.target.value)} placeholder="Add scenario simulation as a later differentiator." maxLength={800}/><button className="primary" onClick={propose} disabled={proposing || idea.trim().length < 8}>{proposing ? "Evaluating…" : "Evaluate change"}</button></div></section>
      <section className="overview-footer" id="timer-setup"><div>{clock ? <><strong>{clock.phase} · {clock.clock} remaining</strong><span>Started {timeLabel(timer?.startedAt)} · ends {timeLabel(timer?.endsAt)}</span></> : <><strong>Hackathon timer</strong><span>Local session countdown with build, stabilize, document, and submit phases.</span></>}</div>{!clock || clock.expired ? <div className="timer-setup"><label htmlFor="duration">Duration</label><select id="duration" value={durationHours} onChange={event => setDurationHours(Number(event.target.value))}><option value={5}>5 hours</option><option value={3}>3 hours</option><option value={8}>8 hours</option></select><button className="secondary" onClick={startTimer}>{clock?.expired ? "Start new session" : "Start timer"}</button></div> : null}</section>
    </div>}

    {view === "Requirements" && <div className="view-content"><PageHeading eyebrow="SOURCE OF TRUTH" title="Requirements" description="Edit project control files and inspect persisted execution reports."/><div className="file-layout"><aside className="file-sidebar"><span className="sidebar-label">PROJECT FILES</span>{EDITABLE.map(file => <button key={file} className={activeFile === file ? "active" : ""} onClick={() => changeFile(file)}>{file.replace(".md", "").replace("PROJECT_STATE", "STATE")}</button>)}<span className="sidebar-label reports-label">REPORTS</span>{REPORTS.map(file => <button key={file} className={activeFile === file ? "active" : ""} onClick={() => changeFile(file)}>{file.replace("reports/", "").replace(".md", "")}</button>)}</aside><section className="mission-card editor-card"><div className="card-kicker"><span>{activeFile}</span><span>{fileDirty ? "UNSAVED CHANGES" : "SAVED"}</span></div><textarea className="state-editor" aria-label={`${activeFile} content`} spellCheck={false} readOnly={activeFile.startsWith("reports/")} value={fileContent} onChange={event => { setFileContent(event.target.value); setFileDirty(true); }}/><div className="editor-footer"><span>{activeFile.startsWith("reports/") ? "Generated report · read only" : "Changes are written to the selected repository."}</span><button className="primary compact" onClick={saveFile} disabled={!fileDirty || saving || activeFile.startsWith("reports/")}>{saving ? "Saving…" : "Save file"}</button></div></section></div><div className="secondary-actions"><button className="secondary" onClick={() => runMilestone()} disabled={execution.running || execution.blocked}>Run milestone</button><button className="secondary" onClick={runVerificationNow} disabled={verifying || execution.running || execution.blocked}>{verifying ? "Verifying…" : "Run verification"}</button></div></div>}

    {view === "Changes" && <div className="view-content"><PageHeading eyebrow="DIRECTION CONTROL" title="Changes" description="Ideas are evaluated locally. Only Apply writes a decision into the target project."/><section className="mission-card changes-input"><div className="card-kicker">NEW IDEA</div><div className="idea-controls"><textarea aria-label="New idea" value={idea} onChange={event => setIdea(event.target.value)} placeholder="Describe a feature or direction change…" maxLength={800}/><button className="primary" onClick={propose} disabled={proposing || idea.trim().length < 8}>{proposing ? "Evaluating…" : "Evaluate change"}</button></div></section>{(["Pending", "Approved", "Deferred", "Rejected"] as ChangeStatus[]).map(status => <section className="change-group" key={status}><div className="group-heading"><h2>{status}</h2><span>{changes.filter(item => item.status === status).length}</span></div>{changes.filter(item => item.status === status).length ? changes.filter(item => item.status === status).map(item => <article className="mission-card proposal-card" key={item.id}><div className="proposal-header"><div><span className="eyebrow">CHANGE PROPOSAL · {timeLabel(item.createdAt)}</span><h3>{item.title}</h3></div><span className={`change-badge ${item.status.toLowerCase()}`}>{item.status}</span></div><p className="proposal-text">{item.text}</p><div className="proposal-facts"><div><span>Current milestone</span><strong>{item.currentMilestone} · unaffected</strong></div><div><span>Suggested placement</span><strong>{item.placement}</strong></div><div><span>Impact</span><strong>{item.impact}</strong></div><div><span>Complexity</span><strong>{item.complexity} · preliminary</strong></div><div><span>New dependency</span><strong>{item.newDependency}</strong></div><div><span>Architecture change</span><strong>{item.architectureChange}</strong></div><div><span>Deadline risk</span><strong>{item.deadlineRisk}</strong></div></div><p className="recommendation">{item.recommendation}</p>{item.status === "Pending" && <div className="proposal-actions"><button className="primary" disabled={Boolean(deciding) || execution.running || execution.blocked} onClick={() => decide(item.id, "Approved")}>Apply</button><button className="secondary" disabled={Boolean(deciding)} onClick={() => decide(item.id, "Deferred")}>Backlog</button><button className="text-button" disabled={Boolean(deciding)} onClick={() => decide(item.id, "Rejected")}>Reject</button>{execution.running && <small>Apply is available after the current Codex run finishes.</small>}</div>}</article>) : <Empty text={status === "Pending" ? "No pending proposals." : `No ${status.toLowerCase()} changes.`}/>}</section>)}</div>}

    {view === "Evidence" && <div className="view-content"><PageHeading eyebrow="BROWSER PROOF" title="Evidence" description="Capture desktop and mobile states, console errors, and failed requests."/><section className="mission-card"><div className="card-kicker">NEW CAPTURE</div><div className="capture-controls"><input aria-label="Capture URL" value={captureUrl} onChange={event => setCaptureUrl(event.target.value)} placeholder="http://localhost:3001"/><select aria-label="Viewport" value={captureSize} onChange={event => setCaptureSize(event.target.value)}><option value="1440x900">Desktop · 1440×900</option><option value="390x844">Mobile · 390×844</option><option value="430x932">Mobile large · 430×932</option></select><button className="primary" onClick={capture} disabled={capturing}>{capturing ? "Capturing…" : "Capture"}</button></div></section><div className="evidence-highlights"><EvidenceFeature label="LATEST DESKTOP" item={latestDesktop}/><EvidenceFeature label="LATEST MOBILE" item={latestMobile}/></div><section className="mission-card"><div className="card-kicker">ALL CAPTURES · {evidence.length}</div><div className="evidence-grid">{evidence.map(item => <EvidenceCard key={item.id} item={item}/>)}</div>{!evidence.length && <Empty text="No browser evidence yet. Start the target application and capture its URL."/>}</section></div>}

    {view === "Git" && <div className="view-content"><PageHeading eyebrow="REPOSITORY STATE" title="Git" description="Read-only status, diff summary, and recent commits."/><div className="git-summary"><div className="mission-card"><span>BRANCH</span><strong>{git?.branch || "—"}</strong></div><div className="mission-card"><span>HEAD</span><strong>{git?.head || "—"}</strong></div><div className="mission-card"><span>CHANGED PATHS</span><strong>{git?.status.length ?? "—"}</strong></div></div><div className="git-columns"><section className="mission-card"><div className="card-kicker">WORKING TREE</div>{git?.status.length ? <pre className="git-pre">{git.status.join("\n")}</pre> : <Empty text="Working tree clean."/>}<div className="card-kicker sub-kicker">DIFF STAT</div>{git?.diffStat ? <pre className="git-pre">{git.diffStat}</pre> : <Empty text="No unstaged diff."/>}</section><section className="mission-card"><div className="card-kicker">RECENT COMMITS</div><div className="commit-list">{git?.commits.map(commit => <div key={commit.sha}><code>{commit.sha}</code><div><strong>{commit.message}</strong><span>{commit.date}</span></div></div>)}</div></section></div></div>}

    {view === "Audit" && <div className="view-content"><PageHeading eyebrow="SUBMISSION CHECK" title="Final audit" description="Technical readiness of the target project. Jury quality and task fit require human review."/><div className="audit-intro mission-card"><div><span className="card-kicker">TARGET PROJECT READINESS</span><div className={`audit-verdict ${documents.audit ? auditReady ? "pass" : "fail" : "unknown"}`}><strong>{documents.audit ? auditReady ? "READY" : "BLOCKED" : "NOT RUN"}</strong><span>{documents.audit ? `${auditChecks.filter(check => check.ok).length} / ${auditChecks.length} checks passed` : "No final audit yet"}</span></div><p>Architect orchestration status: {execution.running ? "Codex working" : execution.blocked ? "Recovery required" : "Available"}. Audit result applies to the selected target repository.</p></div><button className="primary" onClick={runAuditNow} disabled={auditing || execution.running || execution.blocked}>{auditing ? "Auditing…" : "Run final audit"}</button></div><section className="mission-card"><div className="card-kicker">CHECKS · FAILURES FIRST</div>{auditChecks.length ? <div className="audit-list">{[...auditChecks].sort((a,b) => Number(a.ok) - Number(b.ok)).map((check,index) => <div key={`${check.name}-${index}`}><span className={check.ok ? "check-pass" : "check-fail"}>{check.ok ? "✓" : "×"}</span><div><strong>{check.name}</strong>{check.detail && <small>{check.detail}</small>}</div></div>)}</div> : <Empty text="Run the audit before submission to check build, tests, secrets, project documents, README, and environment documentation."/ >}</section></div>}
  </main>;
}

function PageHeading({ eyebrow, title, description }: { eyebrow:string; title:string; description:string }) { return <div className="page-heading"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>; }
function Empty({ text }: { text:string }) { return <div className="empty">{text}</div>; }
function EvidenceCard({ item }: { item:Evidence }) { return <article className="evidence-card"><a href={`/api/evidence/image?file=${encodeURIComponent(item.image)}`} target="_blank" rel="noreferrer"><img src={`/api/evidence/image?file=${encodeURIComponent(item.image)}`} alt={item.title || "Browser evidence"}/></a><div className="evidence-body"><strong>{item.viewport.width}×{item.viewport.height}</strong><span>{timeLabel(item.createdAt)}</span><p title={item.url}>{item.url}</p><div className="evidence-health"><span className={item.consoleErrors.length ? "bad" : "good"}>{item.consoleErrors.length} console errors</span><span className={item.failedRequests.length ? "bad" : "good"}>{item.failedRequests.length} failed requests</span></div>{item.consoleErrors.length > 0 && <details><summary>Console errors</summary><pre>{item.consoleErrors.join("\n")}</pre></details>}{item.failedRequests.length > 0 && <details><summary>Failed requests</summary><pre>{item.failedRequests.join("\n")}</pre></details>}</div></article>; }
function EvidenceFeature({ label, item }: { label:string; item:Evidence|undefined }) { return <section className="mission-card"><div className="card-kicker">{label}</div>{item ? <EvidenceCard item={item}/> : <Empty text="No capture yet."/>}</section>; }
