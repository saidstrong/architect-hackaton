"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Config = { repoPath: string } | null;
type Activity = { at: string; kind: string; message: string };
type Execution = { running: boolean; startedAt: string|null; finishedAt: string|null; exitCode: number|null; activities: Activity[]; finalMessage: string|null };
type GitState = { status: string[]; commits: {sha:string;date:string;message:string}[]; diffStat:string } | null;
type RequestItem = { file:string; type:string; name?:string; reason?:string; required?:boolean; [key:string]:unknown };
type Evidence = { id:string; image:string; createdAt:string; url:string; viewport:{width:number;height:number}; title?:string; consoleErrors:string[]; failedRequests:string[] };
type Audit = { ok:boolean; generatedAt:string; checks:{name:string;ok:boolean;detail?:string}[] };

const FILES = ["TASK.md","ARCHITECTURE.md","PROJECT_STATE.md","ACCEPTANCE.md","DECISIONS.md","HOURLY_LOG.md","reports/latest.md"];

async function jsonFetch<T>(url:string, init?:RequestInit):Promise<T> {
  const res = await fetch(url, { ...init, headers: { "content-type":"application/json", ...(init?.headers || {}) }, cache:"no-store" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

function timeLabel(value:string|null|undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit"});
}

export default function Home() {
  const [config,setConfig] = useState<Config>(null);
  const [repoPath,setRepoPath] = useState("");
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState("");
  const [execution,setExecution] = useState<Execution>({running:false,startedAt:null,finishedAt:null,exitCode:null,activities:[],finalMessage:null});
  const [git,setGit] = useState<GitState>(null);
  const [requests,setRequests] = useState<RequestItem[]>([]);
  const [evidence,setEvidence] = useState<Evidence[]>([]);
  const [activeFile,setActiveFile] = useState("PROJECT_STATE.md");
  const [fileContent,setFileContent] = useState("");
  const [fileDirty,setFileDirty] = useState(false);
  const [saving,setSaving] = useState(false);
  const [secretValues,setSecretValues] = useState<Record<string,string>>({});
  const [captureUrl,setCaptureUrl] = useState("http://localhost:3001");
  const [captureSize,setCaptureSize] = useState("1440x900");
  const [capturing,setCapturing] = useState(false);
  const [audit,setAudit] = useState<Audit|null>(null);
  const [auditing,setAuditing] = useState(false);\n  const [creatingDryRun,setCreatingDryRun] = useState(false);

  const refreshProject = useCallback(async () => {
    const data = await jsonFetch<{config:Config}>("/api/project");
    setConfig(data.config);
    if (data.config) setRepoPath(data.config.repoPath);
    return data.config;
  },[]);

  const refreshLive = useCallback(async () => {
    const [execData,gitData,reqData,evidenceData] = await Promise.all([
      jsonFetch<Execution>("/api/execution"),
      jsonFetch<{git:GitState}>("/api/git"),
      jsonFetch<{requests:RequestItem[]}>("/api/requests"),
      jsonFetch<{evidence:Evidence[]}>("/api/evidence"),
    ]);
    setExecution(execData);
    setGit(gitData.git);
    setRequests(reqData.requests);
    setEvidence(evidenceData.evidence);
  },[]);

  const loadFile = useCallback(async (file:string) => {
    const data = await jsonFetch<{content:string|null}>(`/api/state?file=${encodeURIComponent(file)}`);
    setFileContent(data.content || "");
    setFileDirty(false);
  },[]);

  useEffect(() => {
    (async () => {
      try {
        const selected = await refreshProject();
        if (selected) {
          await Promise.all([refreshLive(),loadFile(activeFile)]);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Initialization failed.");
      } finally {
        setLoading(false);
      }
    })();
  },[refreshProject,refreshLive,loadFile,activeFile]);

  useEffect(() => {
    if (!config) return;
    const id = window.setInterval(() => {
      refreshLive().catch(() => {});
    }, execution.running ? 1200 : 4000);
    return () => window.clearInterval(id);
  },[config,execution.running,refreshLive]);

  async function selectProject() {
    setError("");
    try {
      const data = await jsonFetch<{config:Config}>("/api/project",{method:"POST",body:JSON.stringify({repoPath})});
      setConfig(data.config);
      await Promise.all([refreshLive(),loadFile(activeFile)]);
    } catch(e) {
      setError(e instanceof Error ? e.message : "Unable to select project.");
    }
  }

  async function createDryRun() {
    setCreatingDryRun(true); setError("");
    try {
      const data = await jsonFetch<{result:{repoPath:string;committed:boolean;commitNote:string}}>("/api/dry-run",{method:"POST",body:JSON.stringify({repoPath})});
      setConfig({repoPath:data.result.repoPath});
      setRepoPath(data.result.repoPath);
      await Promise.all([refreshLive(),loadFile(activeFile)]);
    } catch(e) {
      setError(e instanceof Error ? e.message : "Unable to create dry run.");
    } finally { setCreatingDryRun(false); }
  }

  async function saveFile() {
    setSaving(true); setError("");
    try {
      await jsonFetch("/api/state",{method:"POST",body:JSON.stringify({file:activeFile,content:fileContent})});
      setFileDirty(false);
    } catch(e) {
      setError(e instanceof Error ? e.message : "Unable to save.");
    } finally { setSaving(false); }
  }

  async function changeFile(file:string) {
    if (fileDirty && !confirm("Discard unsaved changes?")) return;
    setActiveFile(file);
    await loadFile(file);
  }

  async function runMilestone() {
    setError("");
    try {
      const state = await jsonFetch<Execution>("/api/execution",{method:"POST"});
      setExecution(state);
    } catch(e) { setError(e instanceof Error ? e.message : "Unable to run Codex."); }
  }

  async function saveSecret(req:RequestItem) {
    if (!req.name) return;
    const value = secretValues[req.file] || "";
    setError("");
    try {
      await jsonFetch("/api/secrets",{method:"POST",body:JSON.stringify({name:req.name,value})});
      await jsonFetch("/api/requests",{method:"DELETE",body:JSON.stringify({file:req.file})});
      setSecretValues((old) => ({...old,[req.file]:""}));
      await refreshLive();
    } catch(e) { setError(e instanceof Error ? e.message : "Unable to save secret."); }
  }

  async function resolveRequest(req:RequestItem) {
    await jsonFetch("/api/requests",{method:"DELETE",body:JSON.stringify({file:req.file})});
    await refreshLive();
  }

  async function capture() {
    setCapturing(true); setError("");
    try {
      const [width,height] = captureSize.split("x").map(Number);
      await jsonFetch("/api/evidence",{method:"POST",body:JSON.stringify({url:captureUrl,width,height,title:"Manual browser review"})});
      await refreshLive();
    } catch(e) { setError(e instanceof Error ? e.message : "Capture failed."); }
    finally { setCapturing(false); }
  }

  async function runAuditNow() {
    setAuditing(true); setError("");
    try {
      const data = await jsonFetch<{audit:Audit}>("/api/audit",{method:"POST"});
      setAudit(data.audit);
    } catch(e) { setError(e instanceof Error ? e.message : "Audit failed."); }
    finally { setAuditing(false); }
  }

  const acceptance = useMemo(() => {
    if (activeFile !== "ACCEPTANCE.md") return null;
    const total = (fileContent.match(/- \[[ xX]\]/g) || []).length;
    const done = (fileContent.match(/- \[[xX]\]/g) || []).length;
    return {total,done};
  },[activeFile,fileContent]);

  if (loading) return <main className="center-screen"><div className="loader"/><p>Opening Architect…</p></main>;

  if (!config) {
    return <main className="setup-shell">
      <section className="setup-card">
        <div className="eyebrow">LOCAL CONTROL CENTER</div>
        <h1>Architect</h1>
        <p className="muted">Connect a local Git repository. Architect keeps project state in the repository, runs Codex in a workspace-write sandbox, verifies results, and captures evidence.</p>
        <label>Target repository path</label>
        <input value={repoPath} onChange={(e)=>setRepoPath(e.target.value)} placeholder="C:\Users\Said\Projects\hackalem-project" />
        <div className="setup-actions">
          <button className="primary" onClick={selectProject} disabled={!repoPath.trim() || creatingDryRun}>Connect repository</button>
          <button className="secondary" onClick={createDryRun} disabled={!repoPath.trim() || creatingDryRun}>{creatingDryRun ? "Creating…" : "Create Finance dry run"}</button>
        </div>
        {error && <div className="error-box">{error}</div>}
        <p className="micro"><strong>Connect repository</strong> expects an existing Git repo. <strong>Create Finance dry run</strong> expects an empty/nonexistent absolute folder and initializes Git + a realistic practice task automatically.</p>
      </section>
    </main>;
  }

  return <main className="app-shell">
    <header className="topbar">
      <div>
        <div className="brand-row"><span className="brand-mark">A</span><strong>Architect</strong><span className="local-badge">LOCAL</span></div>
        <div className="repo-path">{config.repoPath}</div>
      </div>
      <div className="top-actions">
        <span className={`status-pill ${execution.running ? "working" : "ready"}`}><i/>{execution.running ? "CODEX WORKING" : "READY"}</span>
        <button className="secondary" onClick={runAuditNow} disabled={auditing}>{auditing ? "Auditing…" : "Final audit"}</button>
        <button className="primary" onClick={runMilestone} disabled={execution.running}>{execution.running ? "Running…" : "Run milestone"}</button>
      </div>
    </header>

    {error && <div className="global-error">{error}<button onClick={()=>setError("")}>×</button></div>}

    <section className="metrics">
      <Metric label="Codex" value={execution.running ? "Working" : execution.exitCode === 0 ? "Last run passed" : execution.exitCode ? "Last run failed" : "Idle"} tone={execution.running ? "blue" : execution.exitCode === 0 ? "green" : "neutral"} />
      <Metric label="Requests" value={requests.length ? `${requests.length} action required` : "None"} tone={requests.length ? "amber" : "green"} />
      <Metric label="Git changes" value={git ? `${git.status.length} path(s)` : "—"} tone={git?.status.length ? "amber" : "green"} />
      <Metric label="Evidence" value={evidence.length ? `${evidence.length} capture(s)` : "None yet"} tone="neutral" />
    </section>

    <section className="dashboard-grid">
      <div className="main-column">
        {requests.length > 0 && <Panel title="Action required" badge={String(requests.length)}>
          <div className="request-list">
            {requests.map((req) => req.type === "secret" ? (
              <div className="request-card secret" key={req.file}>
                <div><span className="request-type">SECRET</span><h3>{req.name}</h3><p>{req.reason || "Codex needs this environment variable to continue."}</p></div>
                <div className="request-controls">
                  <input type="password" autoComplete="off" placeholder={`Paste ${req.name || "secret"}`} value={secretValues[req.file] || ""} onChange={(e)=>setSecretValues((old)=>({...old,[req.file]:e.target.value}))}/>
                  <button className="primary compact" onClick={()=>saveSecret(req)} disabled={!secretValues[req.file]?.trim()}>Save & resolve</button>
                </div>
                <div className="micro">Saved only to the target repo's local <code>.env.local</code>. The value is never shown in Architect state files.</div>
              </div>
            ) : (
              <div className="request-card approval" key={req.file}>
                <div><span className="request-type">APPROVAL</span><h3>{String(req.name || "Architecture decision")}</h3><p>{req.reason || JSON.stringify(req,null,2)}</p></div>
                <button className="secondary compact" onClick={()=>resolveRequest(req)}>Mark resolved</button>
              </div>
            ))}
          </div>
        </Panel>}

        <Panel title="Project control files" subtitle={acceptance ? `${acceptance.done}/${acceptance.total} acceptance checks complete` : undefined}>
          <div className="file-tabs">
            {FILES.map((file)=><button key={file} className={activeFile===file ? "active" : ""} onClick={()=>changeFile(file)}>{file.replace("reports/","")}</button>)}
          </div>
          <textarea className="state-editor" spellCheck={false} value={fileContent} onChange={(e)=>{setFileContent(e.target.value);setFileDirty(true)}}/>
          <div className="editor-footer">
            <span>{fileDirty ? "Unsaved changes" : "Saved"}</span>
            <button className="secondary compact" onClick={saveFile} disabled={!fileDirty || saving}>{saving ? "Saving…" : "Save file"}</button>
          </div>
        </Panel>

        <Panel title="Execution activity" subtitle={execution.startedAt ? `Started ${timeLabel(execution.startedAt)}` : "No run yet"}>
          {execution.finalMessage && <div className={`run-summary ${execution.exitCode===0 ? "pass" : "fail"}`}>{execution.finalMessage}</div>}
          <div className="activity-stream">
            {execution.activities.length === 0 ? <Empty text="Run the current milestone to see Codex and verification activity."/> :
              [...execution.activities].reverse().slice(0,80).map((item,i)=><div className="activity-row" key={`${item.at}-${i}`}><time>{timeLabel(item.at)}</time><span className={`activity-dot ${item.kind}`}/><p>{item.message}</p></div>)}
          </div>
        </Panel>

        <Panel title="Browser evidence" subtitle="Screenshots + console/network failures">
          <div className="capture-controls">
            <input value={captureUrl} onChange={(e)=>setCaptureUrl(e.target.value)} placeholder="http://localhost:3001"/>
            <select value={captureSize} onChange={(e)=>setCaptureSize(e.target.value)}>
              <option value="1440x900">Desktop · 1440×900</option>
              <option value="390x844">Mobile · 390×844</option>
              <option value="430x932">Mobile large · 430×932</option>
            </select>
            <button className="secondary" onClick={capture} disabled={capturing}>{capturing ? "Capturing…" : "Capture"}</button>
          </div>
          <div className="evidence-grid">
            {evidence.slice(0,6).map((item)=><article className="evidence-card" key={item.id}>
              <a href={`/api/evidence/image?file=${encodeURIComponent(item.image)}`} target="_blank"><img src={`/api/evidence/image?file=${encodeURIComponent(item.image)}`} alt={item.title || "Browser evidence"}/></a>
              <div className="evidence-body">
                <strong>{item.viewport.width}×{item.viewport.height}</strong><span>{timeLabel(item.createdAt)}</span>
                <p>{item.url}</p>
                <div className="evidence-health"><span className={item.consoleErrors.length ? "bad" : "good"}>{item.consoleErrors.length} console errors</span><span className={item.failedRequests.length ? "bad" : "good"}>{item.failedRequests.length} failed requests</span></div>
              </div>
            </article>)}
            {!evidence.length && <Empty text="No browser evidence yet. Start the target app, enter its URL, and capture desktop/mobile states."/>}
          </div>
        </Panel>
      </div>

      <aside className="side-column">
        <Panel title="Git">
          <div className="git-status">
            <strong>{git?.status.length || 0}</strong><span>uncommitted paths</span>
          </div>
          {git?.diffStat && <pre className="diff-stat">{git.diffStat}</pre>}
          <div className="commit-list">
            {git?.commits.map((c)=><div key={c.sha}><code>{c.sha}</code><div><strong>{c.message}</strong><span>{c.date}</span></div></div>)}
          </div>
        </Panel>

        <Panel title="Final audit">
          {!audit ? <Empty text="Run the audit before submission to check build, tests, secrets, docs, README, and environment documentation."/> :
          <>
            <div className={`audit-verdict ${audit.ok ? "pass" : "fail"}`}><strong>{audit.ok ? "READY" : "BLOCKED"}</strong><span>{audit.checks.filter(c=>c.ok).length}/{audit.checks.length} checks pass</span></div>
            <div className="audit-list">{audit.checks.map((c)=><div key={c.name}><span className={c.ok ? "check-pass" : "check-fail"}>{c.ok ? "✓" : "×"}</span><div><strong>{c.name}</strong>{c.detail && <small>{c.detail}</small>}</div></div>)}</div>
          </>}
          <button className="secondary wide" onClick={runAuditNow} disabled={auditing}>{auditing ? "Running audit…" : "Run final audit"}</button>
        </Panel>

        <Panel title="Safety">
          <ul className="safety-list">
            <li>Codex uses <code>workspace-write</code> sandbox.</li>
            <li>No arbitrary shell command endpoint.</li>
            <li>Secrets are masked and Git-ignored.</li>
            <li>State lives in the target repository.</li>
            <li>Major architecture changes require approval.</li>
          </ul>
        </Panel>
      </aside>
    </section>
  </main>;
}

function Metric({label,value,tone}:{label:string;value:string;tone:"green"|"amber"|"blue"|"neutral"}) {
  return <div className="metric"><span>{label}</span><div><i className={tone}/><strong>{value}</strong></div></div>
}

function Panel({title,subtitle,badge,children}:{title:string;subtitle?:string;badge?:string;children:React.ReactNode}) {
  return <section className="panel"><header><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{badge && <span className="panel-badge">{badge}</span>}</header><div className="panel-content">{children}</div></section>
}

function Empty({text}:{text:string}) {
  return <div className="empty">{text}</div>
}
