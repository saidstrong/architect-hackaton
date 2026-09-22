import http from "node:http";
const host=process.env.ARCHITECT_WORKER_BIND||"127.0.0.1";
const port=Number(process.env.ARCHITECT_WORKER_PORT||3101);
const localPort=Number(process.env.ARCHITECT_LOCAL_PORT||3000);
if(!Number.isInteger(port)||port<1||port>65535||!Number.isInteger(localPort)||localPort<1||localPort>65535) throw new Error("Invalid worker port.");
http.createServer(async(req,res)=>{
  res.setHeader("Cache-Control","no-store");
  if(req.url!=="/worker/v1"||req.method!=="POST") {res.writeHead(404);res.end();return;}
  if(Number(req.headers["content-length"]||0)>16384) {res.writeHead(413);res.end();return;}
  const chunks=[];let size=0;
  try { for await(const chunk of req) {size+=chunk.length;if(size>16384) throw new Error("large");chunks.push(chunk);} }
  catch {res.writeHead(413);res.end();return;}
  try {
    const upstream=await fetch(`http://127.0.0.1:${localPort}/api/worker-v1`,{method:"POST",headers:{"content-type":"application/json","authorization":req.headers.authorization||"","x-architect-worker":req.headers["x-architect-worker"]||""},body:Buffer.concat(chunks),signal:AbortSignal.timeout(20000)});
    res.writeHead(upstream.status,{"content-type":"application/json","cache-control":"no-store"});res.end(await upstream.text());
  } catch {res.writeHead(503,{"content-type":"application/json"});res.end(JSON.stringify({error:"Architect unavailable."}));}
}).listen(port,host,()=>console.log(`Worker gateway listening on ${host}:${port}. Exposes only POST /worker/v1.`));
