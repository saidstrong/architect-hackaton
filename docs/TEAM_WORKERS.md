# Optional live workers (Stage B)

Stage A remains usable without this service. Solo `npm run dev` and `npm run start` bind to `127.0.0.1`. Live workers use a separate gateway that accepts only `POST /worker/v1` and forwards to the loopback Next server. The gateway has no project editing or command endpoint. Architect owns task definitions, dispatch, and approval; each worker owns its local Codex authentication and checkout; Git owns branches and commits. No automatic merge occurs.

## Start on Architect

1. Start Architect normally on port 3000 and select a Git target repository.
2. On a trusted LAN, explicitly start the worker gateway: `ARCHITECT_WORKER_BIND=0.0.0.0 npm run worker:serve` (PowerShell: `$env:ARCHITECT_WORKER_BIND='0.0.0.0'; npm run worker:serve`). Default gateway binding is loopback. The default gateway port is 3101; `ARCHITECT_WORKER_PORT` changes it. `ARCHITECT_LOCAL_PORT` points it to a nondefault local Next port.
3. In Team, select Worker A, B, or C and generate a connection token. Copy it immediately. Only its SHA-256 hash is stored in an ignored per-project `.architect-runtime/team-live-<project hash>.json` file; the raw token is returned to the local UI once and is not stored in the team state or target Git repository.
4. When the worker is online and READY, select its READY assignment and press **Dispatch selected task**. There is no automatic queue dispatch.

## Start on each worker device

Install this repository and dependencies, install Git and Codex, authenticate Codex *locally*, and clone the target repository with an `origin` remote. Set `ARCHITECT_URL` to `http://<Architect LAN IP>:3101`, `ARCHITECT_WORKER_ID` to A/B/C, `ARCHITECT_WORKER_TOKEN` to the copied token, and `TARGET_REPO` to the clone's absolute root. Run `npm run worker`. A worker checks Git, Codex executable availability, repository root, and Architect authentication before it advertises READY. It never reads or transmits Codex credentials, ChatGPT credentials, or project API keys.

The worker first waits for Architect to acknowledge receipt. It then fetches Git, requires a clean checkout and exact remote main/base SHA, refuses a task branch that already diverged, and runs local `codex exec` with a scoped prompt. It runs configured npm typecheck, test, build, and a secret scan. Unsupported projects or projects without verification scripts are blocked. After success it commits normally and pushes only the assigned task branch. Architect verifies the remote branch head before marking READY FOR REVIEW. Failed verification leaves work uncommitted; failed push leaves the local commit intact. Inspect the branch and merge manually after review.

Worker and Architect each keep ignored runtime journals. A per-worker local lock prevents a second worker process from starting. On network loss, the worker continues the local run and retries queued status updates. After an Architect restart, it reconnects to the persisted dispatch. If the worker process itself dies during an unresolved run, restart reports action required and refuses to start the assignment again; inspect its recorded PID and checkout manually. Heartbeats older than 30 seconds display OFFLINE, without marking a task failed. **Stop after task** prevents further dispatch; it does not kill Codex.

## Security and manual fallback

Binding the gateway to `0.0.0.0` exposes the worker endpoint to the LAN. It uses a bearer token, but plain HTTP does **not** encrypt it. Use only a trusted LAN, or place the gateway behind an authenticated encrypted tunnel. Restrict the gateway port in the host firewall. Rotate the token if exposed. Keep worker tokens in local environment or ignored private runtime configuration; never place them in the target repository, chat, logs, or screenshots. The gateway accepts a 16 KiB maximum request and does not forward any path except `/worker/v1`. The Next server remains loopback bound, so worker credentials do not grant access to local Architect APIs.

The Team panel always retains Stage A task status and result controls. Before a dispatched task is received, **Use manual Stage A** revokes its token and removes the pending dispatch while preserving the TeamTask. After a worker has confirmed execution, coordinate with that teammate before manual reassignment; the UI will not silently discard its run. If networking is unavailable, share the assignment out of band, let the teammate work and push its branch, then record result and status in Stage A.

Stage B is not considered ready for a live event until a separate physical worker device, with its own locally authenticated Codex account, completes the disposable task rehearsal and a disconnect/reconnect test.
