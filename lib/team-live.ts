import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getProjectConfig } from "@/lib/project";
import { runCommand } from "@/lib/process";
import { getTeamSnapshot, recordTeamResult, scopeWarnings, setTeamTaskStatus, type TeamTaskView, type WorkerId } from "@/lib/team";

const Id = z.enum(["A", "B", "C"]);
const Phase = z.enum(["assigned", "received", "working", "verifying", "committing", "pushing", "ready_for_review", "blocked", "failed", "local_result_ready", "action_required"]);
const Activity = z.enum(["received", "codex_started", "codex_exited", "editing", "tests_started", "tests_passed", "build_started", "build_passed", "verification_started", "verification_passed", "verification_failed", "commit_created", "push_started", "push_completed", "failed", "reconnected"]);
const Report = z.object({ dispatchId:z.string().uuid(), phase:Phase, activity:Activity.optional(), path:z.string().max(180).optional(), commit:z.string().regex(/^[0-9a-f]{40}$/).optional(), checks:z.array(z.object({ name:z.string().max(60), ok:z.boolean() }).strict()).max(8).optional(), changedPaths:z.array(z.string().max(180)).max(200).optional() }).strict();
export type LivePhase = z.infer<typeof Phase>;
type Dispatch = { id:string; taskId:string; phase:LivePhase; issuedAt:string; activity:{ at:string; event:string; path?:string }[]; commit?:string; checks?:{name:string;ok:boolean}[]; changedPaths?:string[] };
type LiveWorker = { tokenHash?:string; lastSeen?:string; ready?:boolean; codex?:boolean; git?:boolean; stopAfterTask?:boolean; dispatch?:Dispatch };
type LiveState = { version:1; repo:string; workers:Record<WorkerId,LiveWorker> };
const fileFor = (repo:string) => path.join(process.cwd(), ".architect-runtime", `team-live-${repo}.json`);
const fresh = (repo:string):LiveState => ({ version:1, repo, workers:{ A:{}, B:{}, C:{} } });
let queue:Promise<unknown> = Promise.resolve();
function serial<T>(fn:()=>Promise<T>):Promise<T> { const next=queue.then(fn,fn); queue=next.then(()=>undefined,()=>undefined); return next; }
async function repoKey() { const config=await getProjectConfig(); if(!config) throw new Error("Select a target repository first."); return createHash("sha256").update(path.resolve(config.repoPath).toLowerCase()).digest("hex"); }
async function read():Promise<LiveState> { const repo=await repoKey(); const file=fileFor(repo); try { const value=JSON.parse(await fs.readFile(file,"utf8")) as LiveState; return value.version===1 && value.repo===repo ? value : fresh(repo); } catch(error) { if((error as NodeJS.ErrnoException).code==="ENOENT") return fresh(repo); throw new Error("Worker runtime state is invalid; inspect the project worker runtime file in .architect-runtime."); } }
async function write(value:LiveState) { const file=fileFor(value.repo); await fs.mkdir(path.dirname(file),{recursive:true}); const tmp=`${file}.${randomUUID()}.tmp`; try { await fs.writeFile(tmp,JSON.stringify(value,null,2)+"\n",{flag:"wx",mode:0o600}); await fs.rename(tmp,file); } catch(error) { await fs.unlink(tmp).catch(()=>{}); throw error; } }
function hash(token:string) { return createHash("sha256").update(token).digest("hex"); }
function online(worker:LiveWorker) { return !!worker.lastSeen && Date.now()-Date.parse(worker.lastSeen)<30000; }
function publicWorker(id:WorkerId, worker:LiveWorker, tasks:TeamTaskView[]) { const task=tasks.find(t=>t.id===worker.dispatch?.taskId); return { id, configured:!!worker.tokenHash, connection:online(worker)?"online":"offline", lastSeen:worker.lastSeen, ready:worker.ready, codex:worker.codex, git:worker.git, stopAfterTask:!!worker.stopAfterTask, dispatch:worker.dispatch?{...worker.dispatch,scopeWarnings:task?scopeWarnings(task,tasks,worker.dispatch.changedPaths||[]):[]}:undefined }; }
export async function liveSnapshot() { const state=await read(); const team=await getTeamSnapshot(); return { workers:(["A","B","C"] as WorkerId[]).map(id=>publicWorker(id,state.workers[id],team.tasks)) }; }
export async function generateToken(input:unknown) { const { id }=z.object({id:Id}).strict().parse(input); return serial(async()=>{ const state=await read(); const worker=state.workers[id]; if(worker.dispatch && !["ready_for_review","blocked","failed","local_result_ready","action_required"].includes(worker.dispatch.phase)) throw new Error("Cannot rotate a token during an active assignment."); const token=randomBytes(32).toString("base64url"); state.workers[id]={tokenHash:hash(token)}; await write(state); return {id,token}; }); }
export async function setStopAfterTask(input:unknown) { const {id,enabled}=z.object({id:Id,enabled:z.boolean()}).strict().parse(input); return serial(async()=>{const state=await read(); state.workers[id].stopAfterTask=enabled; await write(state); return liveSnapshot();}); }
export async function useManual(input:unknown) { const {id}=z.object({id:Id}).strict().parse(input); return serial(async()=>{const state=await read(); const worker=state.workers[id]; if(worker.dispatch && worker.dispatch.phase!=="assigned") throw new Error("Worker confirmed execution. Coordinate with the teammate before switching this task to manual."); delete worker.dispatch; delete worker.tokenHash; delete worker.lastSeen; worker.ready=false; await write(state); return liveSnapshot();}); }
export async function dispatchTask(input:unknown) { const {taskId}=z.object({taskId:z.string().uuid()}).strict().parse(input); return serial(async()=>{ const team=await getTeamSnapshot(); const task=team.tasks.find(t=>t.id===taskId); if(!task?.owner) throw new Error("Assign a worker first."); if(task.status!=="ready" || task.waitingFor.length) throw new Error("Task dependencies must be integrated and status READY."); const state=await read(); const worker=state.workers[task.owner]; if(!worker.tokenHash || !online(worker) || !worker.ready) throw new Error("Worker must be online and ready."); if(worker.stopAfterTask) throw new Error("Worker is set to stop after task."); if(worker.dispatch && !["ready_for_review","blocked","failed","local_result_ready","action_required"].includes(worker.dispatch.phase)) throw new Error("Worker already has an active dispatch."); if(team.tasks.some(t=>t.id!==task.id && t.owner===task.owner && ["working","verifying","ready_for_review","blocked"].includes(t.status))) throw new Error("Worker already owns an active task."); worker.dispatch={id:randomUUID(),taskId,phase:"assigned",issuedAt:new Date().toISOString(),activity:[]}; await write(state); return liveSnapshot(); }); }
export async function authenticate(idValue:unknown, bearer:string|null) { const parsed=Id.safeParse(idValue); if(!parsed.success) return null; const id=parsed.data; const state=await read(); const expected=state.workers[id].tokenHash; const token=bearer?.match(/^Bearer ([A-Za-z0-9_-]{40,100})$/)?.[1]; if(!expected || !token) return null; const actual=Buffer.from(hash(token),"hex"), wanted=Buffer.from(expected,"hex"); return timingSafeEqual(actual,wanted)?id:null; }
export async function poll(id:WorkerId, input:unknown) { const body=z.object({ ready:z.boolean(), codex:z.boolean(), git:z.boolean(), currentDispatchId:z.string().uuid().optional() }).strict().parse(input); return serial(async()=>{ const state=await read(); const worker=state.workers[id]; worker.lastSeen=new Date().toISOString(); worker.ready=body.ready; worker.codex=body.codex; worker.git=body.git; const dispatch=worker.dispatch; await write(state); let assignment:TeamTaskView|undefined; let tasks:TeamTaskView[]=[]; if(dispatch && ["assigned","received","working","verifying","committing","pushing"].includes(dispatch.phase)) { const team=await getTeamSnapshot(); tasks=team.tasks; const task=team.tasks.find(t=>t.id===dispatch.taskId); if(task?.owner===id) assignment=task; } return { stopAfterTask:!!worker.stopAfterTask, dispatch: assignment?{id:dispatch!.id,phase:dispatch!.phase,task:{id:assignment.id,title:assignment.title,objective:assignment.objective,branch:assignment.branch,baseSha:assignment.baseSha,dependencies:assignment.dependencies.map(dep=>({id:dep,title:tasks.find(t=>t.id===dep)?.title||dep})),acceptance:assignment.acceptance,ownedPaths:assignment.ownedPaths,avoidPaths:assignment.avoidPaths}}:null }; }); }
export async function report(id:WorkerId,input:unknown) {
  const data=Report.parse(input);
  return serial(async()=>{
    const state=await read();
    const worker=state.workers[id], dispatch=worker.dispatch;
    if(!dispatch || dispatch.id!==data.dispatchId) throw new Error("Unknown dispatch.");
    const team=await getTeamSnapshot(), task=team.tasks.find(t=>t.id===dispatch.taskId);
    if(!task || task.owner!==id) throw new Error("Assignment ownership changed; preserve local work.");
    if(["ready_for_review","blocked","failed","local_result_ready","action_required"].includes(dispatch.phase) && dispatch.phase!==data.phase) throw new Error("Dispatch already finished.");
    const allowed:Record<string,string[]>={
      assigned:["received","action_required"],
      received:["working","failed","action_required"],
      working:["verifying","failed","action_required"],
      verifying:["committing","blocked","failed"],
      committing:["pushing","action_required","failed"],
      pushing:["ready_for_review","local_result_ready","failed"],
    };
    if(dispatch.phase!==data.phase && !allowed[dispatch.phase]?.includes(data.phase)) throw new Error("Invalid worker phase transition.");
    const commit=data.commit||dispatch.commit;
    const checks=data.checks||dispatch.checks;
    if(data.phase==="ready_for_review") {
      if(!commit || !checks?.length || !checks.every(c=>c.ok) || !checks.some(c=>c.name==="Secret scan") || !checks.some(c=>["typecheck","test","build"].includes(c.name))) {
        throw new Error("Task commit, npm verification, and passing secret scan required.");
      }
      const config=await getProjectConfig();
      if(!config) throw new Error("No target repository selected.");
      const remote=await runCommand("git",["ls-remote","--heads","origin",`refs/heads/${task.branch}`],config.repoPath);
      if(remote.exitCode!==0 || remote.stdout.trim().split(/\s/)[0]!==commit) throw new Error("Reported commit is not at the remote task branch head.");
    }
    dispatch.phase=data.phase;
    if(data.activity) {
      dispatch.activity.push({at:new Date().toISOString(),event:data.activity,...(data.path?{path:data.path}:{})});
      dispatch.activity=dispatch.activity.slice(-40);
    }
    if(data.commit) dispatch.commit=data.commit;
    if(data.checks) dispatch.checks=data.checks;
    if(data.changedPaths) dispatch.changedPaths=data.changedPaths;
    worker.lastSeen=new Date().toISOString();
    if(data.phase==="received" || data.phase==="working") await setTeamTaskStatus({taskId:task.id,status:"working"});
    if(data.phase==="verifying") await setTeamTaskStatus({taskId:task.id,status:"verifying"});
    if(data.phase==="ready_for_review") {
      await recordTeamResult({taskId:task.id,latestCommit:commit,passed:true,summary:`Worker ${id} — automated verification: ${checks!.map(c=>c.name).join(", ")}`});
      await setTeamTaskStatus({taskId:task.id,status:"ready_for_review"});
    }
    if(["blocked","failed","action_required","local_result_ready"].includes(data.phase)) {
      await recordTeamResult({taskId:task.id,...(dispatch.commit?{latestCommit:dispatch.commit}:{}),passed:false,summary:`Worker ${id} — automated: ${data.phase.replaceAll("_"," ")}`});
      await setTeamTaskStatus({taskId:task.id,status:data.phase==="failed"?"failed":"blocked"});
    }
    await write(state);
    return {ok:true};
  });
}
