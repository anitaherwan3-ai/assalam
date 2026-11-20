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
async function bootstrapPreviewOwner(input,options={}) {
 guard(options.origin);
 verifyBootstrapSecret(input&&input.bootstrapSecret);
 const email=String(input&&input.email||"").trim().toLowerCase();
 if(email!=="praktekrose@gmail.com") throw fail("Bootstrap hanya untuk akun Pimpinan Utama yang ditetapkan.",403,"PREVIEW_BOOTSTRAP_OWNER_INVALID");
 const password=input&&typeof input.password==="string"?input.password:"";
 if(password.length<12||password.length>128) throw fail("Password TiDB Pimpinan harus 12–128 karakter.",400,"PASSWORD_POLICY");

 let conn=null,locked=false,tx=false,phase="initialize_better_auth";
 const lock="assalam-preview-owner-bootstrap-v2";
 try {
  const auth=await getBetterAuth();
  phase="load_password_context";
  const ctx=await auth.$context;
  if(!ctx||!ctx.password||typeof ctx.password.hash!=="function") throw fail("Hash password Better Auth tidak tersedia.",503,"AUTH_PASSWORD_HASH_UNAVAILABLE");

  phase="hash_password";
  const hash=await ctx.password.hash(password);
  phase="connect_tidb";
  conn=await getPool().getConnection();

  phase="acquire_owner_lock";
  const [l]=await conn.execute("SELECT GET_LOCK(?,8) AS acquired",[lock]);
  locked=Number(l[0]&&l[0].acquired)===1;
  if(!locked) throw fail("Bootstrap sedang diproses oleh sesi lain.",409,"PREVIEW_BOOTSTRAP_BUSY");

  phase="begin_transaction";
  await conn.beginTransaction();tx=true;

  phase="check_better_auth_user";
  const [ba]=await conn.execute("SELECT id,email,emailVerified,role,banned FROM `user` WHERE email=? FOR UPDATE",[email]);
  if(ba.length) {
   const a=ba[0];
   phase="verify_existing_better_auth_owner";
   const [clinic]=await conn.execute("SELECT u.active,u.protected_owner,ra.role_code FROM users u LEFT JOIN active_role_slots ars ON ars.user_id=u.user_id LEFT JOIN role_assignments ra ON ra.role_assignment_id=ars.role_assignment_id AND ra.user_id=ars.user_id WHERE u.user_id=? LIMIT 2 FOR UPDATE",[a.id]);
   const [accounts]=await conn.execute("SELECT id FROM `account` WHERE userId=? AND providerId='credential' LIMIT 2 FOR UPDATE",[a.id]);
   const ok=clinic.length===1&&Number(clinic[0].active)===1&&Number(clinic[0].protected_owner)===1&&clinic[0].role_code==="pimpinan"&&String(a.email).toLowerCase()===email&&Number(a.emailVerified)===1&&a.role==="admin"&&Number(a.banned)===0&&accounts.length===1;
   if(!ok) throw fail("Data owner Preview sudah ada tetapi tidak konsisten; tidak ada data ditimpa.",409,"PREVIEW_OWNER_STATE_CONFLICT");

   // A retry with the same one-time activation secret safely repairs a partial
   // bootstrap/login attempt by refreshing only the protected owner's credential.
   const now=new Date();
   phase="refresh_existing_owner_credential";
   const [refresh]=await conn.execute("UPDATE `account` SET password=?,updatedAt=? WHERE id=? AND userId=? AND providerId='credential'",[hash,now,accounts[0].id,a.id]);
   if(Number(refresh.affectedRows)!==1) throw fail("Kredensial owner Preview tidak berhasil diperbarui.",503,"PREVIEW_OWNER_CREDENTIAL_REFRESH_FAILED");
   phase="audit_owner_credential_refresh";
   await writeAuditEvent(conn,{actorUserId:a.id,actorRole:"pimpinan",actionCode:"PREVIEW_OWNER_CREDENTIAL_REFRESHED",entityType:"clinic_user",entityId:a.id,after:{email,role:"pimpinan",source:"one_time_preview_bootstrap_retry"},reason:"Credential recovery for the protected Preview owner.",requestId:typeof options.requestId==="string"&&options.requestId.length<=100?options.requestId:crypto.randomUUID()});
   phase="commit_existing_owner";
   await conn.commit();tx=false;
   return {ok:true,alreadyProvisioned:true,credentialRefreshed:true,email,role:"pimpinan"};
  }

  phase="load_protected_owner";
  const [owners]=await conn.execute("SELECT user_id,display_name,active FROM users WHERE protected_owner=1 FOR UPDATE");
  if(owners.length>1) throw fail("Database Preview memiliki lebih dari satu owner terlindungi; perlu pemeriksaan manual.",409,"PREVIEW_OWNER_MULTIPLE_RESERVED");

  let id,ownerName="Pimpinan Utama",reuseExistingOwner=false;
  if(owners.length===1) {
   const existing=owners[0];
   if(Number(existing.active)!==1||!existing.user_id) throw fail("Profil owner Preview tidak aktif atau tidak valid; tidak ada data diubah.",409,"PREVIEW_OWNER_STATE_CONFLICT");
   id=String(existing.user_id);ownerName=String(existing.display_name||ownerName);

   phase="verify_protected_owner_auth_identity";
   const [authId]=await conn.execute("SELECT id FROM `user` WHERE id=? FOR UPDATE",[id]);
   if(authId.length) throw fail("ID profil owner sudah digunakan; tidak ada data ditimpa.",409,"PREVIEW_OWNER_STATE_CONFLICT");

   phase="verify_protected_owner_roles";
   const [roles]=await conn.execute("SELECT role_assignment_id,role_code,scope_type,scope_id,granted_by_user_id FROM role_assignments WHERE user_id=? FOR UPDATE",[id]);
   const [slots]=await conn.execute("SELECT ars.role_assignment_id FROM active_role_slots ars INNER JOIN role_assignments ra ON ra.role_assignment_id=ars.role_assignment_id AND ra.user_id=ars.user_id WHERE ars.user_id=? FOR UPDATE",[id]);
   const roleOk=roles.length===1&&roles[0].role_code==="pimpinan"&&roles[0].scope_type==="clinic"&&roles[0].scope_id==null&&String(roles[0].granted_by_user_id)===id;
   const slotOk=slots.length===1&&String(slots[0].role_assignment_id)===String(roles[0]&&roles[0].role_assignment_id);
   if(!roleOk||!slotOk) throw fail("Role atau slot owner Preview tidak konsisten; tidak ada data diubah.",409,"PREVIEW_OWNER_STATE_CONFLICT");
   reuseExistingOwner=true;
  } else {
   id=crypto.randomUUID();
  }

  // The Better Auth schema declares createdAt and updatedAt as DATETIME(3), not BIGINT.
  // mysql2 serializes Date objects using the pool's UTC timezone setting.
  const now=new Date();
  phase="insert_better_auth_user";
  await conn.execute("INSERT INTO `user` (id,name,email,emailVerified,role,banned,createdAt,updatedAt) VALUES (?,?,?,1,'admin',0,?,?)",[id,ownerName,email,now,now]);

  phase="insert_better_auth_account";
  await conn.execute("INSERT INTO `account` (id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES (?,?,'credential',?,?,?,?)",[crypto.randomUUID(),id,id,hash,now,now]);

  if(!reuseExistingOwner) {
   phase="insert_clinic_owner";
   await conn.execute("INSERT INTO users (user_id,display_name,active,protected_owner,created_at_utc,updated_at_utc) VALUES (?, ?,1,1,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[id,ownerName]);
   phase="insert_clinic_owner_role";
   const [ra]=await conn.execute("INSERT INTO role_assignments (user_id,role_code,scope_type,scope_id,valid_from_utc,granted_by_user_id,created_at_utc) VALUES (?,'pimpinan','clinic',NULL,UTC_TIMESTAMP(3),?,UTC_TIMESTAMP(3))",[id,id]);
   phase="insert_active_role_slot";
   await conn.execute("INSERT INTO active_role_slots (role_assignment_id,user_id,activated_at_utc) VALUES (?,?,UTC_TIMESTAMP(3))",[ra.insertId,id]);
  }

  phase="write_bootstrap_audit";
  await writeAuditEvent(conn,{actorUserId:id,actorRole:"pimpinan",actionCode:"PREVIEW_OWNER_BOOTSTRAPPED",entityType:"clinic_user",entityId:id,after:{email,role:"pimpinan",source:"one_time_preview_bootstrap"},reason:"One-time owner provisioning on isolated TiDB migration Preview.",requestId:typeof options.requestId==="string"&&options.requestId.length<=100?options.requestId:crypto.randomUUID()});

  phase="commit_owner";
  await conn.commit();tx=false;
  return {ok:true,alreadyProvisioned:false,email,role:"pimpinan"};
 } catch(e) {
  if(tx&&conn) await conn.rollback().catch(()=>{});
  if(e&&typeof e==="object") e.bootstrapPhase=phase;
  throw e;
 } finally {
  if(conn) {
   if(locked) await conn.execute("SELECT RELEASE_LOCK(?)",[lock]).catch(()=>{});
   conn.release();
  }
 }
}
module.exports={bootstrapPreviewOwner};
