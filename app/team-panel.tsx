"use client";

import { useEffect, useState } from "react";
import type { TeamSnapshot, TeamTaskView, Worker, WorkerId, TaskStatus } from "@/lib/team";

type Props = { repoPath: string; compact?: boolean; onOpen?: () => void };
type LiveWorker = { id:WorkerId; configured:boolean; connection:"online"|"offline"; lastSeen?:string; ready?:boolean; codex?:boolean; git?:boolean; stopAfterTask:boolean; dispatch?:{ id:string; taskId:string; phase:string; commit?:string; checks?:{name:string;ok:boolean}[]; changedPaths?:string[]; scopeWarnings:{path:string;reason:string}[]; activity:{at:string;event:string;path?:string}[] } };
type LiveSnapshot = { workers:LiveWorker[] };
const workerIds: WorkerId[] = ["A", "B", "C"];
const statuses: TaskStatus[] = ["queued", "ready", "working", "verifying", "ready_for_review", "blocked", "failed", "stale"];
const label = (value: string) => value.replaceAll("_", " ").toUpperCase();
const short = (value?: string) => value ? value.slice(0, 8) : "—";
const lines = (value: string) => value.split(/\r?\n|,/).map(item => item.trim()).filter(Boolean);
const suggestion = (title: string) => `feature/${title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 55) || "new-task"}`;

async function request(action?: string, data?: unknown): Promise<TeamSnapshot> {
  const response = await fetch("/api/team", action ? { method:"POST", headers:{ "content-type":"application/json" }, body:JSON.stringify({ action, data }), cache:"no-store" } : { cache:"no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Team request failed.");
  return result.team;
}

export function TeamPanel({ repoPath, compact = false, onOpen }: Props) {
  const [team, setTeam] = useState<TeamSnapshot|null>(null);
  const [live, setLive] = useState<LiveSnapshot|null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedWorker, setSelectedWorker] = useState<WorkerId>("A");
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [names, setNames] = useState<Record<WorkerId,string>>({ A:"", B:"", C:"" });
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [branch, setBranch] = useState("");
  const [owner, setOwner] = useState<WorkerId|"">("");
  const [deps, setDeps] = useState<string[]>([]);
  const [acceptance, setAcceptance] = useState("");
  const [owned, setOwned] = useState("");
  const [avoid, setAvoid] = useState("");
  const [editOwned, setEditOwned] = useState("");
  const [editAvoid, setEditAvoid] = useState("");
  const [editDeps, setEditDeps] = useState<string[]>([]);
  const [latestCommit, setLatestCommit] = useState("");
  const [verificationPassed, setVerificationPassed] = useState(false);
  const [verificationSummary, setVerificationSummary] = useState("");

  useEffect(() => {
    let active = true;
    const refresh=()=>request().then(value => { if (active) setTeam(value); }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Unable to load team."); });
    refresh(); const timer=setInterval(refresh,5000);
    return () => { active = false; clearInterval(timer); };
  }, [repoPath]);
  useEffect(() => {
    let active=true;
    setLive(null);
    const refresh=()=>fetch("/api/team-live",{cache:"no-store"}).then(response=>response.ok?response.json():null).then(value=>{if(active&&value) setLive(value);}).catch(()=>{});
    refresh(); const timer=setInterval(refresh,5000);
    return()=>{active=false;clearInterval(timer);};
  },[repoPath]);
  useEffect(() => { if (team) setNames({ A:team.workers[0].name, B:team.workers[1].name, C:team.workers[2].name }); }, [team]);
  const selectedTask = team?.tasks.find(task => task.id === selectedTaskId);
  useEffect(() => {
    if (!selectedTask) return;
    setEditOwned(selectedTask.ownedPaths.join("\n")); setEditAvoid(selectedTask.avoidPaths.join("\n")); setEditDeps(selectedTask.dependencies);
    setLatestCommit(selectedTask.latestCommit || ""); setVerificationPassed(selectedTask.verification?.passed === true); setVerificationSummary(selectedTask.verification?.summary || "");
  }, [selectedTaskId, selectedTask?.updatedAt]);

  async function act(action: string, data: unknown) {
    setBusy(true); setError("");
    try { setTeam(await request(action, data)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Team update failed."); }
    finally { setBusy(false); }
  }
  async function createTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || !objective.trim()) return;
    setBusy(true); setError("");
    try {
      const next = await request("createTask", { title:title.trim(), objective:objective.trim(), branch:branch.trim() || suggestion(title), ...(owner ? { owner } : {}), dependencies:deps, acceptance:lines(acceptance), ownedPaths:lines(owned), avoidPaths:lines(avoid) });
      setTeam(next); setSelectedTaskId(next.tasks.at(-1)?.id || "");
      setTitle(""); setObjective(""); setBranch(""); setOwner(""); setDeps([]); setAcceptance(""); setOwned(""); setAvoid("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to create task."); }
    finally { setBusy(false); }
  }
  if (!team) return <section className="mission-card team-panel"><div className="card-kicker">TEAM</div><p className="muted">{error || "Loading local team state…"}</p></section>;
  const integrated = team.tasks.filter(task => task.status === "integrated");
  const branches = team.tasks.filter(task => task.status !== "integrated");
  const workerTask = (worker: Worker) => team.tasks.find(task => task.id === worker.currentTaskId) || team.tasks.find(task => task.owner === worker.id && task.status !== "integrated" && task.status !== "failed");
  const liveLabel = (worker:Worker) => {const item=live?.workers.find(value=>value.id===worker.id);return item?.connection==="online"?`● ${item.dispatch&&["working","verifying","committing","pushing"].includes(item.dispatch.phase)?label(item.dispatch.phase):"ONLINE"}`:item?.configured?"○ OFFLINE":`MANUAL · ${label(worker.status)}`;};

  if (compact) return <section className="mission-card team-panel team-compact"><div className="card-kicker"><span>TEAM · LOCAL COORDINATION</span><button className="text-button" onClick={onOpen}>Open Team →</button></div><div className="team-progress-strip"><span><strong>{integrated.length}</strong> integrated on local {team.mainBranch}</span><span><strong>{branches.length}</strong> on worker branches / queued</span></div><div className="team-worker-grid">{team.workers.map(worker => { const task = workerTask(worker); return <button className="team-worker-tile" key={worker.id} onClick={onOpen}><span className="team-worker-id">{worker.id}</span><strong>{worker.name}</strong><small className={`team-tone ${worker.status}`}>{liveLabel(worker)}</small><span>{task?.title || "No assigned task"}</span><code>{task?.branch || "—"}</code></button>; })}</div><p className="team-note">Branch work is pending until its commit is merged into local {team.mainBranch} and explicitly marked integrated.</p></section>;

  return <div className="view-content team-view"><div className="page-heading"><span className="eyebrow">MISSION CONTROL · TEAM</span><h1>Team</h1><p>Assign work locally. Connected workers can execute a dispatched task on their own device; manual Stage A coordination remains available.</p></div>
    {error && <div className="global-error" role="alert">{error}<button aria-label="Dismiss team error" onClick={() => setError("")}>×</button></div>}
    <div className="team-progress-strip team-progress-main"><span><strong>{integrated.length}</strong> integrated on local {team.mainBranch} <code>{short(team.mainSha)}</code></span><span><strong>{branches.length}</strong> branch / queued tasks</span><span>Local refs only · refresh after external Git changes <button className="text-button" onClick={() => request().then(setTeam).catch(cause => setError(String(cause)))}>Refresh</button></span></div>
    <section className="mission-card"><div className="card-kicker"><span>WORKERS</span><span>Exactly three local assignments</span></div><div className="team-worker-grid">{team.workers.map(worker => { const task = workerTask(worker); return <button key={worker.id} className={`team-worker-tile ${selectedWorker === worker.id ? "selected" : ""}`} onClick={() => setSelectedWorker(worker.id)}><span className="team-worker-id">{worker.id}</span><strong>{worker.name}</strong><small className={`team-tone ${worker.status}`}>{liveLabel(worker)}</small><span>{task?.title || "No assigned task"}</span><code>{task?.branch || "—"}</code></button>; })}</div>
      {team.workers.filter(worker => worker.id === selectedWorker).map(worker => { const task = workerTask(worker); return <div className="team-detail" key={worker.id}><div className="team-detail-heading"><h2>Worker {worker.id}</h2><span>Latest activity {worker.lastActivityAt ? new Date(worker.lastActivityAt).toLocaleString() : "—"}</span></div><div className="team-fields"><label>Name<input aria-label={`Worker ${worker.id} name`} value={names[worker.id]} onChange={event => setNames(old => ({ ...old, [worker.id]:event.target.value }))}/></label><button className="secondary compact" disabled={busy || !names[worker.id].trim() || names[worker.id] === worker.name} onClick={() => act("worker", { id:worker.id, name:names[worker.id].trim() })}>Save name</button><label>Status<select aria-label={`Worker ${worker.id} status`} value={worker.status} onChange={event => act("worker", { id:worker.id, status:event.target.value })} disabled={busy}>{["offline", "idle", "working", "verifying", "ready_for_review", "blocked"].map(status => <option key={status} value={status}>{label(status)}</option>)}</select></label></div><div className="team-capabilities"><span>Capabilities (metadata only)</span>{(["codex", "openaiApi", "nvidiaApi"] as const).map(key => <label key={key}><input type="checkbox" checked={worker.capabilities[key] === true} onChange={event => act("worker", { id:worker.id, capabilities:{ ...worker.capabilities, [key]:event.target.checked } })} disabled={busy}/>{key === "codex" ? "Codex" : key === "openaiApi" ? "OpenAI API" : "NVIDIA API"}</label>)}</div><div className="team-worker-info"><div><span>Current task</span><strong>{task?.title || "None"}</strong></div><div><span>Branch</span><code>{task?.branch || "—"}</code></div><div><span>Base / latest</span><code>{short(task?.baseSha)} / {short(task?.latestCommit)}</code></div><div><span>Verification</span><strong>{task?.verification?.passed === true ? "Worker reported passed" : task?.verification?.passed === false ? "Worker reported failed" : "Pending"}</strong></div><div><span>Owned paths</span><code>{task?.ownedPaths.join(", ") || "—"}</code></div></div></div>; })}</section>
    <LivePanel workerId={selectedWorker} team={team} live={live} selectedTaskId={selectedTaskId} onTeamRefresh={() => request().then(setTeam).catch(cause => setError(String(cause)))} onLiveRefresh={() => fetch("/api/team-live",{cache:"no-store"}).then(response=>response.json()).then(setLive).catch(cause=>setError(String(cause)))}/><section className="mission-card team-create"><div className="card-kicker">CREATE TEAM TASK</div><form onSubmit={createTask}><div className="team-form-grid"><label>Title<input aria-label="Team task title" value={title} onChange={event => { if (!branch || branch === suggestion(title)) setBranch(suggestion(event.target.value)); setTitle(event.target.value); }} required maxLength={160}/></label><label>Task branch<input aria-label="Task branch" value={branch} onChange={event => setBranch(event.target.value)} placeholder={suggestion(title)} required maxLength={180}/></label><label className="team-wide">Objective<textarea aria-label="Task objective" value={objective} onChange={event => setObjective(event.target.value)} required maxLength={2000}/></label><label>Owner<select aria-label="Task owner" value={owner} onChange={event => setOwner(event.target.value as WorkerId|"")}><option value="">Unassigned</option>{team.workers.map(worker => <option key={worker.id} value={worker.id}>{worker.id} · {worker.name}</option>)}</select></label><fieldset><legend>Dependencies</legend>{team.tasks.length ? team.tasks.filter(task => task.status !== "failed").map(task => <label className="team-check" key={task.id}><input type="checkbox" checked={deps.includes(task.id)} onChange={event => setDeps(old => event.target.checked ? [...old, task.id] : old.filter(id => id !== task.id))}/>{task.title} · {label(task.status)}</label>) : <span className="micro">None yet</span>}</fieldset><label>Acceptance criteria <small>one per line</small><textarea aria-label="Acceptance criteria" value={acceptance} onChange={event => setAcceptance(event.target.value)}/></label><label>Owned paths <small>one glob per line</small><textarea aria-label="Owned paths" value={owned} onChange={event => setOwned(event.target.value)} placeholder="lib/finance/**"/></label><label>Avoid paths <small>one glob per line</small><textarea aria-label="Avoid paths" value={avoid} onChange={event => setAvoid(event.target.value)} placeholder="lib/ai/**"/></label></div><div className="team-form-footer"><span>Records the assignment and current local main SHA. It does not create or checkout a Git branch.</span><button className="primary" disabled={busy || !title.trim() || !objective.trim() || !branch.trim()}>{busy ? "Saving…" : "Create team task"}</button></div></form></section>
    <section className="team-task-section"><div className="team-section-heading"><h2>Task queue</h2><span>{team.tasks.length} tasks</span></div>{team.tasks.length ? <div className="team-task-layout"><div className="team-task-list">{team.tasks.map(task => <button key={task.id} className={`team-task-card ${selectedTaskId === task.id ? "selected" : ""}`} onClick={() => setSelectedTaskId(task.id)}><span className={`team-tone ${task.effectiveStatus}`}>{label(task.effectiveStatus)}</span><strong>{task.title}</strong><small>{task.owner ? `${task.owner} · ${team.workers.find(worker => worker.id === task.owner)?.name}` : "Unassigned"} · {task.branch}</small>{task.waitingFor.length > 0 && <span className="team-warning">Waiting for {task.waitingFor.map(id => team.tasks.find(item => item.id === id)?.title || id).join(", ")}</span>}{task.staleBase && task.status !== "integrated" && <span className="team-warning">BASE OUTDATED</span>}{task.scopeWarnings.length > 0 && <span className="team-warning">{task.scopeWarnings.length} scope warning(s)</span>}</button>)}</div>{selectedTask ? <TaskDetail task={selectedTask} team={team} busy={busy} act={act} editDeps={editDeps} setEditDeps={setEditDeps} editOwned={editOwned} setEditOwned={setEditOwned} editAvoid={editAvoid} setEditAvoid={setEditAvoid} latestCommit={latestCommit} setLatestCommit={setLatestCommit} verificationPassed={verificationPassed} setVerificationPassed={setVerificationPassed} verificationSummary={verificationSummary} setVerificationSummary={setVerificationSummary}/> : <div className="mission-card team-task-detail muted">Select a task to inspect its assignment and Git state.</div>}</div> : <div className="empty">No team tasks yet. Create a scoped task above.</div>}</section>
  </div>;
}

function TaskDetail({ task, team, busy, act, editDeps, setEditDeps, editOwned, setEditOwned, editAvoid, setEditAvoid, latestCommit, setLatestCommit, verificationPassed, setVerificationPassed, verificationSummary, setVerificationSummary }: {
  task: TeamTaskView; team: TeamSnapshot; busy:boolean; act:(action:string,data:unknown)=>Promise<void>;
  editDeps:string[]; setEditDeps:(value:string[])=>void; editOwned:string; setEditOwned:(value:string)=>void; editAvoid:string; setEditAvoid:(value:string)=>void;
  latestCommit:string; setLatestCommit:(value:string)=>void; verificationPassed:boolean; setVerificationPassed:(value:boolean)=>void; verificationSummary:string; setVerificationSummary:(value:string)=>void;
}) {
  return <article className="mission-card team-task-detail"><div className="card-kicker"><span>ASSIGNMENT · {task.owner ? `WORKER ${task.owner}` : "UNASSIGNED"}</span><span className={`team-tone ${task.effectiveStatus}`}>{label(task.effectiveStatus)}</span></div><h3>{task.title}</h3><p>{task.objective}</p><div className="team-facts"><div><span>Branch</span><code>{task.branch} {task.branchAvailable ? "· available locally" : "· not fetched locally"}</code></div><div><span>Base</span><code>{short(task.baseSha)}</code></div><div><span>Current local {team.mainBranch}</span><code>{short(team.mainSha)}</code></div><div><span>Latest commit</span><code>{short(task.latestCommit)} · worker reported</code></div></div>{task.staleBase && task.status !== "integrated" && <div className="team-alert">BASE OUTDATED · This task started at {short(task.baseSha)}; local {team.mainBranch} is {short(team.mainSha)}. Review before integration. No automatic rebase.</div>}{task.waitingFor.length > 0 && <div className="team-alert">Waiting for integration: {task.waitingFor.map(id => team.tasks.find(item => item.id === id)?.title || id).join(", ")}</div>}
    <div className="team-two-col"><label>Owner<select aria-label="Edit task owner" value={task.owner || ""} disabled={busy || task.status === "integrated"} onChange={event => act("updateTask", { taskId:task.id, owner:event.target.value || null })}><option value="">Unassigned</option>{team.workers.map(worker => <option value={worker.id} key={worker.id}>{worker.id} · {worker.name}</option>)}</select></label><label>Status<select aria-label="Task status" value={task.effectiveStatus} disabled={busy || task.status === "integrated"} onChange={event => act("status", { taskId:task.id, status:event.target.value })}>{task.status === "integrated" && <option value="integrated">INTEGRATED</option>}{statuses.map(status => <option value={status} key={status}>{label(status)}</option>)}</select></label></div><small className="micro">Ready for review means the worker indicated implementation is done. Verification is recorded separately below.</small>
    <div className="team-subsection"><strong>Dependencies and scope</strong><div className="team-deps">{team.tasks.filter(item => item.id !== task.id).map(item => <label className="team-check" key={item.id}><input type="checkbox" disabled={busy || task.status === "integrated"} checked={editDeps.includes(item.id)} onChange={event => setEditDeps(event.target.checked ? [...editDeps, item.id] : editDeps.filter(id => id !== item.id))}/>{item.title} · {label(item.status)}</label>)}</div><div className="team-two-col"><label>Owned paths<textarea aria-label="Edit owned paths" value={editOwned} disabled={task.status === "integrated"} onChange={event => setEditOwned(event.target.value)}/></label><label>Avoid paths<textarea aria-label="Edit avoid paths" value={editAvoid} disabled={task.status === "integrated"} onChange={event => setEditAvoid(event.target.value)}/></label></div><button className="secondary compact" disabled={busy || task.status === "integrated"} onClick={() => act("updateTask", { taskId:task.id, dependencies:editDeps, ownedPaths:lines(editOwned), avoidPaths:lines(editAvoid) })}>Save dependencies and scope</button></div>
    <div className="team-subsection"><strong>Acceptance</strong>{task.acceptance.length ? <ul>{task.acceptance.map((criterion,index) => <li key={index}>{criterion}</li>)}</ul> : <p className="micro">No criteria recorded.</p>}</div>
    <div className="team-subsection"><strong>Branch changes and scope warnings</strong>{task.branchAvailable ? task.changedPaths.length ? <ul className="team-paths">{task.changedPaths.map(file => <li key={file}><code>{file}</code></li>)}</ul> : <p className="micro">No committed changes relative to task base.</p> : <p className="micro">Task branch is not available in local refs. Fetch it manually to inspect committed changes.</p>}{task.scopeWarnings.length ? <div className="team-alert"><strong>SCOPE WARNING</strong>{task.scopeWarnings.map((warning,index) => <p key={`${warning.path}-${index}`}><code>{warning.path}</code> · {warning.reason}</p>)}</div> : <p className="micro">No detected scope overlap in available branch changes.</p>}</div>
    <div className="team-subsection"><strong>Worker result</strong><div className="team-two-col"><label>Latest commit SHA<input aria-label="Latest task commit" value={latestCommit} onChange={event => setLatestCommit(event.target.value)} disabled={task.status === "integrated"} placeholder="Git commit SHA"/></label><label>Verification outcome<select aria-label="Verification outcome" value={verificationPassed ? "passed" : "not-passed"} onChange={event => setVerificationPassed(event.target.value === "passed")} disabled={task.status === "integrated"}><option value="not-passed">Pending or failed</option><option value="passed">Worker reported passed</option></select></label></div><label>Verification summary<textarea aria-label="Verification summary" value={verificationSummary} onChange={event => setVerificationSummary(event.target.value)} disabled={task.status === "integrated"} maxLength={1000}/></label><button className="secondary compact" disabled={busy || task.status === "integrated"} onClick={() => act("result", { taskId:task.id, ...(latestCommit.trim() ? { latestCommit:latestCommit.trim() } : {}), passed:verificationPassed, summary:verificationSummary.trim() })}>Record worker result</button></div>
    {task.status === "ready_for_review" && <div className="team-integration"><div><strong>Manual integration</strong><p>Merge and verify this branch outside Architect. Then mark integrated; Architect checks that the reported commit is on local {team.mainBranch}.</p></div><button className="primary compact" disabled={busy || task.verification?.passed !== true || !task.latestCommit} onClick={() => act("integrated", { taskId:task.id })}>Mark integrated</button></div>}
  </article>;
}

function LivePanel({workerId,team,live,selectedTaskId,onTeamRefresh,onLiveRefresh}:{workerId:WorkerId;team:TeamSnapshot;live:LiveSnapshot|null;selectedTaskId:string;onTeamRefresh:()=>void;onLiveRefresh:()=>void}) {
  const [token,setToken]=useState("");
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  useEffect(()=>setToken(""),[workerId]);
  const worker=live?.workers.find(item=>item.id===workerId);
  const selected=team.tasks.find(task=>task.id===selectedTaskId);
  const dispatched=team.tasks.find(task=>task.id===worker?.dispatch?.taskId);
  async function action(name:string,data:unknown) {setBusy(true);setError("");try {const response=await fetch("/api/team-live",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:name,data})});const value=await response.json();if(!response.ok) throw new Error(value.error||"Live action failed.");if(name==="generate") setToken(value.token);onLiveRefresh();onTeamRefresh();} catch(cause) {setError(cause instanceof Error?cause.message:"Live action failed.");}finally {setBusy(false);}}
  return <section className="mission-card team-live"><div className="card-kicker"><span>OPTIONAL LIVE EXECUTION · WORKER {workerId}</span><span>{worker?.connection==="online"?"● ONLINE":"○ OFFLINE"}</span></div>
    <p className="micro">Start the separate worker gateway on Architect, then connect the worker from its device. Manual coordination below works without any connection.</p>
    {error&&<p className="team-alert" role="alert">{error}</p>}
    {worker?.connection==="offline"&&worker.dispatch?.phase==="assigned"&&<p className="team-alert">WORKER OFFLINE · Task not confirmed running.</p>}
    <div className="team-worker-info"><div><span>Connection</span><strong>{worker?.connection?.toUpperCase()||"OFFLINE"}</strong></div><div><span>Codex / Git</span><strong>{worker?.codex?"Available":"Unknown"} / {worker?.git?"Available":"Unknown"}</strong></div><div><span>Task</span><strong>{dispatched?.title||"None"}</strong></div><div><span>Phase</span><strong>{worker?.dispatch?label(worker.dispatch.phase):"MANUAL / IDLE"}</strong></div><div><span>Last heartbeat</span><strong>{worker?.lastSeen?new Date(worker.lastSeen).toLocaleString():"—"}</strong></div><div><span>Commit</span><code>{short(worker?.dispatch?.commit)}</code></div></div>
    {!worker?.configured&&<button className="secondary compact" disabled={busy} onClick={()=>action("generate",{id:workerId})}>Generate connection</button>}
    {worker?.configured&&<button className="secondary compact" disabled={busy||!!worker.dispatch&&!(["ready_for_review","blocked","failed","local_result_ready","action_required"].includes(worker.dispatch.phase))} onClick={()=>action("generate",{id:workerId})}>Rotate token</button>}
    {token&&<div className="team-alert"><strong>Copy now · token shown once</strong><p>Architect URL: <code>http://&lt;Architect LAN IP&gt;:3101</code></p><p>Worker: <code>{workerId}</code></p><p>Token: <code>{token}</code></p><p>On the worker device, set ARCHITECT_URL, ARCHITECT_WORKER_ID, ARCHITECT_WORKER_TOKEN, and TARGET_REPO, then run <code>npm run worker</code>. Keep the token private.</p><button className="secondary compact" onClick={()=>setToken("")}>Hide token</button></div>}
    <div className="team-form-footer"><span>Dispatch only a READY task assigned to Worker {workerId}. Dependencies must be integrated.</span><button className="primary compact" disabled={busy||!selected||selected.owner!==workerId||selected.status!=="ready"||worker?.connection!=="online"||!worker.ready||!!worker.stopAfterTask} onClick={()=>action("dispatch",{taskId:selectedTaskId})}>Dispatch selected task</button></div>
    <div className="team-form-footer"><span>Stop after task lets the current run finish and prevents another dispatch.</span><button className="secondary compact" disabled={busy||!worker?.configured} onClick={()=>action("stopAfterTask",{id:workerId,enabled:!worker?.stopAfterTask})}>{worker?.stopAfterTask?"Resume assignments":"Stop after task"}</button></div>
    {(!worker?.dispatch||worker.dispatch.phase==="assigned")&&<button className="text-button" disabled={busy} onClick={()=>action("manual",{id:workerId})}>Use manual Stage A for Worker {workerId}</button>}
    {worker?.dispatch&&<div className="team-subsection"><strong>Latest activity</strong><ul>{worker.dispatch.activity.slice(-8).reverse().map((item,index)=><li key={`${item.at}-${index}`}>{new Date(item.at).toLocaleTimeString()} · {label(item.event)} {item.path&&<code>{item.path}</code>}</li>)}</ul><strong>Automated verification</strong><p>{worker.dispatch.checks?.map(check=>`${check.ok?"✓":"✕"} ${check.name}`).join(" · ")||"Pending"}</p><strong>Changed paths and scope</strong><p className="micro">{worker.dispatch.changedPaths?.join(", ")||"Pending"}</p>{worker.dispatch.scopeWarnings.length?<div className="team-alert">{worker.dispatch.scopeWarnings.map((warning,index)=><p key={index}><code>{warning.path}</code> · {warning.reason}</p>)}</div>:<p className="micro">No scope warnings reported.</p>}{worker.dispatch.phase==="ready_for_review"&&<button className="secondary compact" onClick={()=>{onTeamRefresh();document.querySelector(".team-task-section")?.scrollIntoView({behavior:"smooth"});}}>Review task</button>}</div>}
  </section>;
}
