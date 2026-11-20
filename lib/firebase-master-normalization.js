"use strict";
const ALLOWED_UNITS=new Set(["tablet","kapsul","botol","pcs"]);
const UNIT_ALIASES=Object.freeze({strip:"pcs"});
function fail(message,code){const e=new Error(message);e.code=code;throw e;}
function entries(rows,name){if(!Array.isArray(rows))fail("Koleksi "+name+" harus berupa array.","MASTER_COLLECTION_INVALID");const seen=new Set();return rows.map((row,i)=>{if(!row||typeof row!=="object"||!row.data||typeof row.data!=="object")fail("Dokumen "+name+" ke-"+(i+1)+" tidak valid.","MASTER_DOCUMENT_INVALID");const id=String(row.documentId||"").trim();if(!id||seen.has(id))fail("ID dokumen "+name+" kosong/duplikat.","MASTER_DOCUMENT_ID_DUPLICATE");seen.add(id);if(row.data.id!=null&&String(row.data.id)!==id)fail("ID dokumen tidak cocok pada "+name+"/"+id,"MASTER_DOCUMENT_ID_MISMATCH");return {id,data:row.data};});}
function num(v,label,min=0){const n=Number(v);if(!Number.isSafeInteger(n)||n<min)fail(label+" harus bilangan bulat minimal "+min+".","MASTER_NUMBER_INVALID");return n;}
function txt(v,label,max){const s=typeof v==="string"?v.trim():"";if(!s||s.length>max)fail(label+" kosong/terlalu panjang.","MASTER_TEXT_INVALID");return s;}
function pub(c,id){return "firebase-"+c+"-"+id;}
function unique(rows,key,label){const s=new Set();for(const r of rows){const k=String(key(r)).toLowerCase().trim();if(s.has(k))fail("Nama master duplikat pada "+label+": "+k,"MASTER_BUSINESS_KEY_DUPLICATE");s.add(k);}}
function buildFirebaseMasterPlan(input){
 if(!input||input.sourceProject!=="assalam-preview-test"||!input.collections)fail("Sumber bukan Firebase Preview yang disetujui.","MASTER_SOURCE_PROJECT_MISMATCH");
 const medicines=entries(input.collections.k_obat,"k_obat").map(({id,data})=>{const old=txt(data.satuan,"Satuan obat "+id,16).toLowerCase(),unit=UNIT_ALIASES[old]||old;if(!ALLOWED_UNITS.has(unit))fail("Satuan obat "+id+" bukan tablet/kapsul/botol/pcs.","MASTER_UNIT_NOT_ALLOWED");return {legacyId:id,publicId:pub("k_obat",id),name:txt(data.nama,"Nama obat "+id,180),canonicalUnit:unit,originalUnit:old,sellingPrice:num(data.jual,"Harga obat "+id),minimumStock:num(data.min,"Stok minimum "+id),active:1};});
 const tariffs=entries(input.collections.k_tarif,"k_tarif").map(({id,data})=>({legacyId:id,publicId:pub("k_tarif",id),name:txt(data.nama,"Nama tarif "+id,180),serviceType:txt(data.jenis,"Jenis tarif "+id,80),price:num(data.harga,"Harga tarif "+id),active:1}));
 const medIds=new Set(medicines.map(x=>x.legacyId)),tariffIds=new Set(tariffs.map(x=>x.legacyId)),packages=[],components=[];
 for(const {id,data} of entries(input.collections.k_paket,"k_paket")){
  const description=typeof data.deskripsi==="string"?data.deskripsi.trim():"";if(description.length>255)fail("Deskripsi paket "+id+" terlalu panjang.","MASTER_TEXT_INVALID");
  const p={legacyId:id,publicId:pub("k_paket",id),name:txt(data.nama,"Nama paket "+id,180),description,packagePrice:num(data.harga,"Harga paket "+id)};
  if(!Array.isArray(data.items)||!data.items.length)fail("Paket "+id+" tidak memiliki komponen.","MASTER_PACKAGE_COMPONENTS_MISSING");
  data.items.forEach((item,i)=>{if(!item||typeof item!=="object")fail("Komponen paket tidak valid.","MASTER_PACKAGE_COMPONENT_INVALID");const type=item.type==="obat"?"medicine":item.type==="tarif"?"tariff":"";if(!type)fail("Jenis komponen tidak dikenal.","MASTER_PACKAGE_COMPONENT_TYPE_INVALID");const ref=String(type==="medicine"?(item.oid||item.id||""):(item.id||"")).trim();if(!ref||(type==="medicine"?!medIds.has(ref):!tariffIds.has(ref)))fail("Referensi paket "+id+"/"+i+" tidak ditemukan.","MASTER_PACKAGE_REFERENCE_UNRESOLVED");if(type==="medicine"&&item.oid&&String(item.oid)!==String(item.id))fail("ID obat/OID paket berbeda.","MASTER_PACKAGE_REFERENCE_MISMATCH");const qty=num(item.qty,"Qty paket "+id+"/"+i,1),price=num(item.harga,"Harga komponen "+id+"/"+i);if(!Number.isSafeInteger(qty*price))fail("Total komponen tidak aman.","MASTER_PACKAGE_TOTAL_UNSAFE");components.push({packageLegacyId:id,componentType:type,medicineLegacyId:type==="medicine"?ref:null,tariffLegacyId:type==="tariff"?ref:null,quantity:qty,sortOrder:i,componentPriceSnapshot:price,componentNameSnapshot:txt(item.nama,"Nama komponen "+id+"/"+i,180)});});
  packages.push(p);
 }
 unique(medicines,x=>x.name,"obat");unique(tariffs,x=>x.name+"|"+x.serviceType,"tarif");unique(packages,x=>x.name,"paket");
 const checks=packages.map(p=>{const sum=components.filter(x=>x.packageLegacyId===p.legacyId).reduce((a,x)=>a+x.quantity*x.componentPriceSnapshot,0);return {packageLegacyId:p.legacyId,componentTotal:sum,packagePrice:p.packagePrice,difference:p.packagePrice-sum};});
 return {sourceProject:input.sourceProject,medicines,tariffs,packages,components,packagePriceChecks:checks,summary:{medicineCount:medicines.length,tariffCount:tariffs.length,packageCount:packages.length,packageComponentCount:components.length,normalizedLegacyStripCount:medicines.filter(x=>x.originalUnit==="strip").length,stockBalancesImported:false,hppImported:false},safety:{dryRunOnly:true,sourceModified:false,targetWritten:false,productionCutoverAllowed:false}};
}
module.exports={buildFirebaseMasterPlan,ALLOWED_UNITS,UNIT_ALIASES};
