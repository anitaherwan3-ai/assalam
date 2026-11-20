"use strict";
const {getBetterAuth}=require("../../lib/better-auth");
const {bootstrapPreviewOwner}=require("../../lib/preview-owner-bootstrap");
const {getPool}=require("../../lib/tidb");
const {requireBetterAuthActor,requireRole}=require("../../lib/require-better-auth-actor");
const {dryRunFirebaseMasterImport}=require("../../lib/firebase-master-dry-run");
let nodeHandlerPromise;
async function readJsonBody(req){
 if(req.body&&typeof req.body==="object")return req.body;
 const chunks=[];let size=0;
 for await(const chunk of req){const b=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=b.length;if(size>12288){const e=new Error("Ukuran permintaan terlalu besar.");e.statusCode=413;e.code="REQUEST_BODY_TOO_LARGE";throw e;}chunks.push(b);}
 try{return JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch(_){const e=new Error("Format permintaan tidak valid.");e.statusCode=400;e.code="REQUEST_JSON_INVALID";throw e;}
}
async function bootstrapRoute(req,res){
 res.setHeader("Cache-Control","no-store, private");res.setHeader("Vary","Origin");
 if(req.method!=="POST"){res.setHeader("Allow","POST");return res.status(405).json({ok:false,code:"METHOD_NOT_ALLOWED"});}
 try{const body=await readJsonBody(req);const result=await bootstrapPreviewOwner(body,{origin:typeof req.headers.origin==="string"?req.headers.origin:"",requestId:req.headers["x-request-id"]});return res.status(200).json(result);}
 catch(e){const status=Number(e.statusCode)||503;if(status>=500)console.error("[PREVIEW-OWNER-BOOTSTRAP]",{code:e.code||"UNKNOWN",phase:e.bootstrapPhase||"guard_or_request",errno:Number.isFinite(e.errno)?e.errno:undefined,sqlState:typeof e.sqlState==="string"?e.sqlState:undefined,message:String(e.sqlMessage||e.message||"").slice(0,240)});return res.status(status).json({ok:false,code:e.code||"PREVIEW_OWNER_BOOTSTRAP_FAILED",message:status>=500?"Bootstrap Pimpinan Preview belum tersedia.":e.message});}
}
async function previewOwnerStatusRoute(req,res){
 res.setHeader("Cache-Control","no-store, private");
 if(req.method!=="GET"){res.setHeader("Allow","GET");return res.status(405).json({ok:false,code:"METHOD_NOT_ALLOWED"});}
 if(process.env.VERCEL_ENV!=="preview"||process.env.VERCEL_GIT_COMMIT_REF!=="migration/tidb-foundation"||process.env.TIDB_DATABASE!=="assalam_db"||String(process.env.TIDB_PREVIEW_OWNER_EMAIL||"").trim().toLowerCase()!=="praktekrose@gmail.com"){
  return res.status(404).json({ok:false,code:"PREVIEW_OWNER_STATUS_UNAVAILABLE"});
 }
 try{
  const pool=getPool();
  const [owners]=await pool.execute("SELECT user_id,active,protected_owner FROM users WHERE protected_owner=1");
  const owner=owners.length===1?owners[0]:null;
  const [authRows]=await pool.execute("SELECT id,emailVerified,role,banned FROM `user` WHERE email=? LIMIT 2",["praktekrose@gmail.com"]);
  const auth=authRows.length===1?authRows[0]:null;
  const userId=owner?String(owner.user_id):(auth?String(auth.id):"");
  let accounts=[],roles=[];
  if(userId){
   [accounts]=await pool.execute("SELECT id FROM `account` WHERE userId=? AND providerId='credential'",[userId]);
   [roles]=await pool.execute("SELECT ra.role_assignment_id,ra.role_code,ra.scope_type,ra.scope_id,ra.granted_by_user_id,ars.role_assignment_id AS active_role_assignment_id FROM role_assignments ra LEFT JOIN active_role_slots ars ON ars.role_assignment_id=ra.role_assignment_id AND ars.user_id=ra.user_id WHERE ra.user_id=?",[userId]);
  }
  const roleOk=roles.length===1&&roles[0].role_code==="pimpinan"&&roles[0].scope_type==="clinic"&&roles[0].scope_id==null&&String(roles[0].granted_by_user_id)===userId;
  const slotOk=roleOk&&String(roles[0].active_role_assignment_id)===String(roles[0].role_assignment_id);
  return res.status(200).json({ok:true,protectedOwnerCount:owners.length,protectedOwnerActive:!!(owner&&Number(owner.active)===1&&Number(owner.protected_owner)===1),authUserCount:authRows.length,authIdentityMatches:!!(owner&&auth&&String(owner.user_id)===String(auth.id)),authEmailVerified:!!(auth&&Number(auth.emailVerified)===1),authProviderRoleValid:!!(auth&&auth.role==="admin"&&Number(auth.banned)===0),credentialAccountCount:accounts.length,clinicPimpinanRoleValid:roleOk,activeRoleSlotValid:slotOk});
 }catch(e){
  console.error("[PREVIEW-OWNER-STATUS]",{code:e.code||"UNKNOWN"});
  return res.status(503).json({ok:false,code:"PREVIEW_OWNER_STATUS_FAILED"});
 }
}
async function sessionRoute(req,res){
 res.setHeader("Cache-Control","no-store, private");res.setHeader("Vary","Cookie");
 if(req.method!=="GET"){res.setHeader("Allow","GET");return res.status(405).json({ok:false,code:"METHOD_NOT_ALLOWED"});}
 try{return res.status(200).json({ok:true,actor:await requireBetterAuthActor(req)});}
 catch(e){const status=Number(e.statusCode)||503;return res.status(status).json({ok:false,code:e.code||"AUTH_SESSION_FAILED",message:status>=500?"Sesi TiDB belum tersedia.":e.message});}
}
async function dryRunRoute(req,res){
 res.setHeader("Cache-Control","no-store, private");
 if(req.method!=="POST"){res.setHeader("Allow","POST");return res.status(405).json({ok:false,code:"METHOD_NOT_ALLOWED"});}
 try{requireRole(await requireBetterAuthActor(req),["pimpinan"]);return res.status(200).json({ok:true,data:await dryRunFirebaseMasterImport()});}
 catch(e){const status=Number(e.statusCode)||503;if(status>=500)console.error("[FIREBASE-MASTER-DRY-RUN]",{code:e.code||"UNKNOWN"});return res.status(status).json({ok:false,code:e.code||"FIREBASE_MASTER_DRY_RUN_FAILED",message:status>=500?"Dry-run master data belum tersedia.":e.message});}
}
async function handler(req,res){
 const originalUrl=String(req.headers["x-matched-path"]||req.url||"");
 const urlObj=new URL(originalUrl,"http://localhost");
 const path=urlObj.pathname;
 if(path==="/api/auth/preview-owner-status")return previewOwnerStatusRoute(req,res);
 if(path==="/api/auth/session")return sessionRoute(req,res);
 if(path==="/api/auth/preview-bootstrap")return bootstrapRoute(req,res);
 if(path==="/api/auth/preview-import-dry-run")return dryRunRoute(req,res);
 if(path.startsWith("/api/auth/")&&req.url!==originalUrl){
  req.url=originalUrl;
 }
 try{
  if(!nodeHandlerPromise){nodeHandlerPromise=Promise.all([import("better-auth/node"),getBetterAuth()]).then(([adapter,auth])=>adapter.toNodeHandler(auth.handler||auth));nodeHandlerPromise.catch(()=>{nodeHandlerPromise=null;});}
  return await (await nodeHandlerPromise)(req,res);
 }catch(e){console.error("[BETTER-AUTH]",{code:e&&e.code?e.code:"AUTH_HANDLER_ERROR",message:e&&e.message});res.statusCode=503;res.setHeader("Cache-Control","no-store");return res.end(JSON.stringify({ok:false,code:"AUTH_SERVICE_UNAVAILABLE"}));}
}
module.exports=handler;
module.exports.config={api:{bodyParser:false}};
