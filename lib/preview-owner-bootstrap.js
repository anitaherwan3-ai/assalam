"use strict";
const crypto=require("node:crypto");
const {getPool}=require("./tidb");
const {getBetterAuth}=require("./better-auth");
const {writeAuditEvent}=require("./audit");
function fail(message,statusCode,code){const e=new Error(message);e.statusCode=statusCode;e.code=code;return e;}
function env(name,minLength=1){const v=String(process.env[name]||"").trim();if(v.length<minLength)throw fail("Konfigurasi bootstrap Preview belum lengkap.",503,"PREVIEW_BOOTSTRAP_CONFIG_MISSING");return v;}
function guard(origin){
 if(process.env.VERCEL_ENV!=="preview"||process.env.VERCEL_GIT_COMMIT_REF!=="migration/tidb-foundation"||
 process.env.TIDB_DATABASE!=="assalam_db"||process.env.TIDB_PREVIEW_OWNER_BOOTSTRAP_ENABLED!=="true")
  throw fail("Bootstrap hanya aktif pada Preview migrasi yang diizinkan.",404,"PREVIEW_BOOTSTRAP_DISABLED");
 if(origin!==new URL(env("BETTER_AUTH_URL")).origin)throw fail("Buka domain Preview utama sebelum aktivasi Pimpinan.",403,"PREVIEW_BOOTSTRAP_ORIGIN_REJECTED");
 if(env("TIDB_PREVIEW_OWNER_EMAIL").toLowerCase()!=="praktekrose@gmail.com")throw fail("Identitas owner Preview tidak cocok.",503,"PREVIEW_BOOTSTRAP_OWNER_CONFIG_INVALID");
 env("TIDB_PREVIEW_OWNER_BOOTSTRAP_SECRET",32);
}
function verifyBootstrapSecret(value){
 const expected=Buffer.from(env("TIDB_PREVIEW_OWNER_BOOTSTRAP_SECRET",32),"utf8");
 const supplied=Buffer.from(typeof value==="string"?value:"","utf8");
 if(supplied.length!==expected.length||!crypto.timingSafeEqual(supplied,expected))
  throw fail("Kode aktivasi awal tidak valid.",403,"PREVIEW_BOOTSTRAP_SECRET_REJECTED");
}
async function bootstrapPreviewOwner(input,options={}){
 guard(options.origin);
 verifyBootstrapSecret(input&&input.bootstrapSecret);
 const email=String(input&&input.email||"").trim().toLowerCase();
 if(email!=="praktekrose@gmail.com")throw fail("Bootstrap hanya untuk akun Pimpinan Utama yang ditetapkan.",403,"PREVIEW_BOOTSTRAP_OWNER_INVALID");
 const password=input&&typeof input.password==="string"?input.password:"";
 if(password.length<12||password.length>128)throw fail("Password TiDB Pimpinan harus 12–128 karakter.",400,"PASSWORD_POLICY");
 const auth=await getBetterAuth(),ctx=await auth.$context;
 if(!ctx||!ctx.password||typeof ctx.password.hash!=="function")throw fail("Hash password Better Auth tidak tersedia.",503,"AUTH_PASSWORD_HASH_UNAVAILABLE");
 const hash=await ctx.password.hash(password),conn=await getPool().getConnection();
 const lock="assalam-preview-owner-bootstrap-v2";let locked=false,tx=false;
 try{
  const [l]=await conn.execute("SELECT GET_LOCK(?,8) AS acquired",[lock]);locked=Number(l[0]&&l[0].acquired)===1;
  if(!locked)throw fail("Bootstrap sedang diproses oleh sesi lain.",409,"PREVIEW_BOOTSTRAP_BUSY");
  await conn.beginTransaction();tx=true;
  const [ba]=await conn.execute("SELECT id,email,emailVerified,role,banned FROM \`user\` WHERE email=? FOR UPDATE",[email]);
  if(ba.length){
   const a=ba[0];
   const [clinic]=await conn.execute("SELECT u.active,u.protected_owner,ra.role_code FROM users u LEFT JOIN active_role_slots ars ON ars.user_id=u.user_id LEFT JOIN role_assignments ra ON ra.role_assignment_id=ars.role_assignment_id AND ra.user_id=u.user_id WHERE u.user_id=? LIMIT 2 FOR UPDATE",[a.id]);
   const [accounts]=await conn.execute("SELECT id FROM \`account\` WHERE userId=? AND providerId='credential' LIMIT 2 FOR UPDATE",[a.id]);
   const ok=clinic.length===1&&Number(clinic[0].active)===1&&Number(clinic[0].protected_owner)===1&&clinic[0].role_code==="pimpinan"&&String(a.email).toLowerCase()===email&&Number(a.emailVerified)===1&&a.role==="admin"&&Number(a.banned)===0&&accounts.length===1;
   if(!ok)throw fail("Data owner Preview sudah ada tetapi tidak konsisten; tidak ada data ditimpa.",409,"PREVIEW_OWNER_STATE_CONFLICT");
   await conn.commit();tx=false;return {ok:true,alreadyProvisioned:true,email,role:"pimpinan"};
  }
  const [owners]=await conn.execute("SELECT user_id FROM users WHERE protected_owner=1 FOR UPDATE");
  if(owners.length)throw fail("Database Preview sudah memiliki owner terlindungi yang berbeda.",409,"PREVIEW_OWNER_ALREADY_RESERVED");
  const id=crypto.randomUUID(),now=new Date();
  await conn.execute("INSERT INTO \`user\` (id,name,email,emailVerified,role,banned,createdAt,updatedAt) VALUES (?,?,?,1,'admin',0,?,?)",[id,"Pimpinan Utama",email,now,now]);
  await conn.execute("INSERT INTO \`account\` (id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES (?,?,'credential',?,?,?,?)",[crypto.randomUUID(),id,id,hash,now,now]);
  await conn.execute("INSERT INTO users (user_id,display_name,active,protected_owner,created_at_utc,updated_at_utc) VALUES (?, ?,1,1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[id,"Pimpinan Utama"]);
  const [ra]=await conn.execute("INSERT INTO role_assignments (user_id,role_code,scope_type,scope_id,valid_from_utc,granted_by_user_id,created_at_utc) VALUES (?,'pimpinan','clinic',NULL,UTC_TIMESTAMP(3),?,UTC_TIMESTAMP(3))",[id,id]);
  await conn.execute("INSERT INTO active_role_slots (role_assignment_id,user_id,activated_at_utc) VALUES (?,?,UTC_TIMESTAMP(3))",[ra.insertId,id]);
  await writeAuditEvent(conn,{actorUserId:id,actorRole:"pimpinan",actionCode:"PREVIEW_OWNER_BOOTSTRAPPED",entityType:"clinic_user",entityId:id,after:{email,role:"pimpinan",source:"one_time_preview_bootstrap"},reason:"One-time owner provisioning on isolated TiDB migration Preview.",requestId:typeof options.requestId==="string"&&options.requestId.length<=100?options.requestId:crypto.randomUUID()});
  await conn.commit();tx=false;return {ok:true,alreadyProvisioned:false,email,role:"pimpinan"};
 }catch(e){if(tx)await conn.rollback().catch(()=>{});throw e;}
 finally{if(locked)await conn.execute("SELECT RELEASE_LOCK(?)",[lock]).catch(()=>{});conn.release();}
}
module.exports={bootstrapPreviewOwner};
