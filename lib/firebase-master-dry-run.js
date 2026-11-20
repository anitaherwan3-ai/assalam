"use strict";
const fixture=require("../config/firebase-master-import-fixture.v1.json");
const {buildFirebaseMasterPlan}=require("./firebase-master-normalization");
const {getPool}=require("./tidb");
const marks=a=>a.map(()=>"?").join(",");
async function dryRunFirebaseMasterImport(){
 const p=buildFirebaseMasterPlan(fixture),pool=getPool();
 const med=p.medicines.map(x=>x.publicId),tar=p.tariffs.map(x=>x.publicId),legacy=p.tariffs.map(x=>x.legacyId),pkg=p.packages.map(x=>x.publicId);
 const [mr]=await pool.execute("SELECT public_id,name FROM medicines WHERE public_id IN ("+marks(med)+")",med);
 const [tr]=await pool.execute("SELECT public_id,legacy_id,name FROM tariffs WHERE public_id IN ("+marks(tar)+") OR legacy_id IN ("+marks(legacy)+")",[...tar,...legacy]);
 const [pr]=await pool.execute("SELECT public_id,name FROM service_packages WHERE public_id IN ("+marks(pkg)+")",pkg);
 const [cols]=await pool.execute("SELECT TABLE_NAME,COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND ((TABLE_NAME='service_packages' AND COLUMN_NAME='package_price') OR (TABLE_NAME='package_components' AND COLUMN_NAME IN ('component_price_snapshot','component_name_snapshot')))");
 const found=new Set(cols.map(x=>x.TABLE_NAME+"."+x.COLUMN_NAME));
 const required=["service_packages.package_price","package_components.component_price_snapshot","package_components.component_name_snapshot"],missing=required.filter(x=>!found.has(x));
 const collisions=[];
 for(const x of p.medicines){const [r]=await pool.execute("SELECT public_id FROM medicines WHERE LOWER(TRIM(name))=LOWER(TRIM(?))",[x.name]);if(r.length)collisions.push({type:"medicine",legacyId:x.legacyId,name:x.name,count:r.length});}
 for(const x of p.tariffs){const [r]=await pool.execute("SELECT public_id FROM tariffs WHERE LOWER(TRIM(name))=LOWER(TRIM(?)) AND LOWER(TRIM(service_type))=LOWER(TRIM(?))",[x.name,x.serviceType]);if(r.length)collisions.push({type:"tariff",legacyId:x.legacyId,name:x.name,count:r.length});}
 for(const x of p.packages){const [r]=await pool.execute("SELECT public_id FROM service_packages WHERE LOWER(TRIM(name))=LOWER(TRIM(?))",[x.name]);if(r.length)collisions.push({type:"package",legacyId:x.legacyId,name:x.name,count:r.length});}
 const dups=mr.length+pr.length+tr.filter(x=>tar.includes(x.public_id)).length,dupLegacy=tr.filter(x=>x.legacy_id&&legacy.includes(x.legacy_id)).length;
 return {ok:!missing.length&&!dups&&!dupLegacy&&!collisions.length,mode:"read_only_dry_run",sourceProject:p.sourceProject,targetDatabase:"assalam_db",planned:p.summary,duplicatePublicIds:dups,duplicateLegacyTariffIds:dupLegacy,normalizedNameCollisions:collisions,unresolvedPackageReferences:0,packagePriceChecks:p.packagePriceChecks,requiredSchemaColumns:{missing},safety:{sourceFirebaseWrites:0,targetTiDBWrites:0,importedStock:false,importedHpp:false,productionCutoverAllowed:false}};
}
module.exports={dryRunFirebaseMasterImport};
