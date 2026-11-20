"use strict";
module.exports=Object.freeze({
 version:"016_service_package_price_snapshots",
 description:"Preserve service package selling prices and component price/name snapshots",
 expectedTables:Object.freeze(["service_packages","package_components"]),
 statements:Object.freeze([
  "ALTER TABLE service_packages ADD COLUMN package_price BIGINT NOT NULL DEFAULT 0 AFTER description",
  "ALTER TABLE package_components ADD COLUMN component_price_snapshot BIGINT NOT NULL DEFAULT 0 AFTER quantity",
  "ALTER TABLE package_components ADD COLUMN component_name_snapshot VARCHAR(180) NOT NULL DEFAULT '' AFTER component_price_snapshot"
 ])
});
