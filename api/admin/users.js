"use strict";
const crypto = require("node:crypto");
const { getPool } = require("../../lib/tidb");
const { getBetterAuth } = require("../../lib/better-auth");
const { requireBetterAuthActor, requireRole, toWebHeaders } = require("../../lib/require-better-auth-actor");
const { writeAuditEvent } = require("../../lib/audit");
const { validateNewUser, providerRole, assertRosterImmutable } = require("../../lib/clinic-user-policy");
const FIXED = new Set(["praktekrose@gmail.com","nursalim42@gmail.com","assalamkasir1@gmail.com","assalamkasir2@gmail.com","assalamadmin1@gmail.com"]);
function rid(req) { const v=req.headers["x-request-id"]; return typeof v==="string" && v.length<=100 ? v : crypto.randomUUID(); }
module.exports = async function handler(req,res) {
 res.setHeader("Cache-Control","no-store, private"); res.setHeader("Vary","Cookie");
 try {
  const actor=requireRole(await requireBetterAuthActor(req),["pimpinan"]);
  const pool=getPool(), auth=await getBetterAuth(), headers=toWebHeaders(req.headers);
  if(req.method==="GET") {
   const [rows]=await pool.execute("SELECT u.user_id userId,u.display_name name,ba.email,u.active,u.protected_owner protectedOwner,ra.role_code role,ba.banned FROM users u JOIN `user` ba ON ba.id=u.user_id LEFT JOIN active_role_slots ars ON ars.user_id=u.user_id LEFT JOIN role_assignments ra ON ra.role_assignment_id=ars.role_assignment_id ORDER BY u.protected_owner DESC,u.display_name");
   return res.status(200).json({ok:true,data:rows.map(x=>({userId:String(x.userId),name:x.name,email:x.email,role:x.role||null,active:Number(x.active)===1,protectedOwner:Number(x.protectedOwner)===1,banned:Number(x.banned)===1}))});
  }
  if(req.method==="POST") {
   const input=validateNewUser(req.body);
   const created=await auth.api.createUser({body:{email:input.email,name:input.name,password:input.password,role:input.providerRole},headers});
   const userId=created && (created.id || (created.user && created.user.id));
   if(typeof userId!=="string" || !userId) throw Object.assign(new Error("Provider tidak mengembalikan identitas akun."),{code:"AUTH_CREATE_INVALID_RESPONSE"});
   const conn=await pool.getConnection();
   try {
    await conn.beginTransaction();
    await conn.execute("INSERT INTO users(user_id,display_name,active,protected_owner,created_at_utc,updated_at_utc) VALUES(?,?,1,0,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[userId,input.name]);
    const [a]=await conn.execute("INSERT INTO role_assignments(user_id,role_code,scope_type,scope_id,valid_from_utc,granted_by_user_id,created_at_utc) VALUES(?,?,'clinic',NULL,UTC_TIMESTAMP(3),?,UTC_TIMESTAMP(3))",[userId,input.role,actor.userId]);
    await conn.execute("INSERT INTO active_role_slots(role_assignment_id,user_id,activated_at_utc) VALUES(?,?,UTC_TIMESTAMP(3))",[a.insertId,userId]);
    await writeAuditEvent(conn,{actorUserId:actor.userId,actorRole:actor.role,actionCode:"USER_CREATED",entityType:"clinic_user",entityId:userId,after:{email:input.email,name:input.name,role:input.role},requestId:rid(req)});
    await conn.commit();
   } catch(e) {
    await conn.rollback();
    await pool.execute("DELETE FROM `account` WHERE userId=?",[userId]);
    await pool.execute("DELETE FROM `session` WHERE userId=?",[userId]);
    await pool.execute("DELETE FROM `user` WHERE id=?",[userId]);
    throw e;
   } finally { conn.release(); }
   return res.status(201).json({ok:true,data:{userId,email:input.email,role:input.role}});
  }
  if(req.method==="PATCH") {
   const b=req.body||{}, userId=typeof b.userId==="string"?b.userId:"";
   if(!userId) return res.status(400).json({ok:false,code:"USER_ID_REQUIRED"});
   const [rows]=await pool.execute("SELECT u.user_id userId,u.display_name name,u.protected_owner protectedOwner,ba.email,ra.role_code role FROM users u JOIN `user` ba ON ba.id=u.user_id LEFT JOIN active_role_slots ars ON ars.user_id=u.user_id LEFT JOIN role_assignments ra ON ra.role_assignment_id=ars.role_assignment_id WHERE u.user_id=? LIMIT 1",[userId]);
   if(!rows.length) return res.status(404).json({ok:false,code:"USER_NOT_FOUND"});
   const old=rows[0], locked=Number(old.protectedOwner)===1||FIXED.has(String(old.email).toLowerCase());
   const email=b.email===undefined?old.email:String(b.email).trim().toLowerCase(), role=b.role===undefined?old.role:b.role, name=b.name===undefined?old.name:String(b.name).trim();
   if(locked&&(email!==old.email||role!==old.role||name!==old.name)) throw Object.assign(new Error("Lima akun awal dikunci: email, nama, dan role tidak dapat diubah."),{code:"BOOTSTRAP_ROSTER_IMMUTABLE",statusCode:409});
   assertRosterImmutable(old.email,email,role,userId,locked);
   if(b.password!==undefined) {
    if(typeof b.password!=="string"||b.password.length<12||b.password.length>128) return res.status(400).json({ok:false,code:"PASSWORD_POLICY",message:"Password harus 12–128 karakter."});
    await auth.api.setUserPassword({body:{userId,newPassword:b.password},headers});
   }
   if(email.length>254||!email.includes("@")||!["pimpinan","admin","kasir"].includes(role)||!name||name.length>120) return res.status(400).json({ok:false,code:"USER_FIELDS_INVALID"});
   if(email!==old.email||role!==old.role||name!==old.name) {
    const conn=await pool.getConnection();
    try {
     await conn.beginTransaction();
     await conn.execute("UPDATE users SET display_name=?,updated_at_utc=UTC_TIMESTAMP(3),version=version+1 WHERE user_id=?",[name,userId]);
     await conn.execute("UPDATE `user` SET name=?,email=?,role=? WHERE id=?",[name,email,providerRole(role),userId]);
     if(role!==old.role) {
      await conn.execute("UPDATE role_assignments SET valid_to_utc=UTC_TIMESTAMP(3) WHERE user_id=? AND valid_to_utc IS NULL",[userId]);
      await conn.execute("DELETE FROM active_role_slots WHERE user_id=?",[userId]);
      const [a]=await conn.execute("INSERT INTO role_assignments(user_id,role_code,scope_type,scope_id,valid_from_utc,granted_by_user_id,created_at_utc) VALUES(?,?,'clinic',NULL,UTC_TIMESTAMP(3),?,UTC_TIMESTAMP(3))",[userId,role,actor.userId]);
      await conn.execute("INSERT INTO active_role_slots(role_assignment_id,user_id,activated_at_utc) VALUES(?,?,UTC_TIMESTAMP(3))",[a.insertId,userId]);
     }
     await writeAuditEvent(conn,{actorUserId:actor.userId,actorRole:actor.role,actionCode:"USER_UPDATED",entityType:"clinic_user",entityId:userId,before:{email:old.email,name:old.name,role:old.role},after:{email,name,role},requestId:rid(req)});
     await conn.commit();
    } catch(e) { await conn.rollback(); throw e; } finally { conn.release(); }
   }
   return res.status(200).json({ok:true,data:{userId,email,name,role,passwordUpdated:b.password!==undefined}});
  }
  if(req.method==="DELETE") {
   const userId=req.body&&typeof req.body.userId==="string"?req.body.userId:"";
   if(!userId) return res.status(400).json({ok:false,code:"USER_ID_REQUIRED"});
   const conn=await pool.getConnection();
   try {
    await conn.beginTransaction();
    const [rows]=await conn.execute("SELECT u.user_id userId,u.protected_owner protectedOwner,ba.email,ra.role_code role FROM users u JOIN `user` ba ON ba.id=u.user_id LEFT JOIN active_role_slots ars ON ars.user_id=u.user_id LEFT JOIN role_assignments ra ON ra.role_assignment_id=ars.role_assignment_id WHERE u.user_id=? FOR UPDATE",[userId]);
    if(!rows.length) { await conn.rollback(); return res.status(404).json({ok:false,code:"USER_NOT_FOUND"}); }
    const target=rows[0];
    if(Number(target.protectedOwner)===1||FIXED.has(String(target.email).toLowerCase())) throw Object.assign(new Error("Lima akun awal tidak dapat dinonaktifkan."),{code:"BOOTSTRAP_ROSTER_IMMUTABLE",statusCode:409});
    await conn.execute("UPDATE users SET active=0,updated_at_utc=UTC_TIMESTAMP(3),version=version+1 WHERE user_id=?",[userId]);
    await conn.execute("UPDATE role_assignments SET valid_to_utc=UTC_TIMESTAMP(3) WHERE user_id=? AND valid_to_utc IS NULL",[userId]);
    await conn.execute("DELETE FROM active_role_slots WHERE user_id=?",[userId]);
    await conn.execute("UPDATE `user` SET banned=1,banReason='Disabled by clinic Pimpinan' WHERE id=?",[userId]);
    await conn.execute("DELETE FROM `session` WHERE userId=?",[userId]);
    await writeAuditEvent(conn,{actorUserId:actor.userId,actorRole:actor.role,actionCode:"USER_DISABLED",entityType:"clinic_user",entityId:userId,before:{email:target.email,role:target.role,active:true},after:{active:false},requestId:rid(req)});
    await conn.commit();
   } catch(e) { await conn.rollback(); throw e; } finally { conn.release(); }
   return res.status(200).json({ok:true,data:{userId,active:false,deleted:false}});
  }
  res.setHeader("Allow","GET, POST, PATCH, DELETE");
  return res.status(405).json({ok:false,code:"METHOD_NOT_ALLOWED"});
 } catch(error) {
  const status=Number(error&&error.statusCode)||503;
  if(status>=500) console.error("[ADMIN-USERS] Request failed",{code:error.code||"UNKNOWN"});
  return res.status(status).json({ok:false,code:error.code||"USER_MANAGEMENT_FAILED",message:status>=500?"Layanan manajemen akun sedang tidak tersedia.":error.message});
 }
};
