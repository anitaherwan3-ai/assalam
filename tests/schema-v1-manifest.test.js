"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const manifest = require("../config/schema-v1-manifest.json");

test("schema v1 dictionary covers all 71 physical tables and their keys", () => {
  assert.equal(manifest.tableCount, 71);
  assert.equal(Object.keys(manifest.tables).length, manifest.tableCount);
  assert.ok(manifest.tables.user && manifest.tables.session && manifest.tables.account && manifest.tables.verification);
  assert.equal(manifest.tables.patient_handoffs, undefined);
  for (const table of Object.values(manifest.tables)) {
    assert.ok(table.columns.length > 0);
    assert.ok(table.primaryKey.length > 0);
  }
});

test("every foreign key has a matching child index and exact parent unique key", () => {
  for (const [childName, child] of Object.entries(manifest.tables)) {
    for (const fk of child.foreignKeys) {
      const childIndexExists = child.indexes.some(index =>
        fk.columns.every((column, position) => index.columns[position] === column)
      ) || fk.columns.every((column, position) => child.primaryKey[position] === column);
      assert.equal(childIndexExists, true, childName + "." + fk.name + " needs a child index");
      const parent = manifest.tables[fk.referencedTable];
      assert.ok(parent, childName + "." + fk.name + " references an unknown table");
      const parentKeyExists = (parent.primaryKey.length === fk.referencedColumns.length &&
        parent.primaryKey.every((column, position) => column === fk.referencedColumns[position])) ||
        parent.indexes.some(index => index.unique && index.columns.length === fk.referencedColumns.length &&
          index.columns.every((column, position) => column === fk.referencedColumns[position]));
      assert.equal(parentKeyExists, true, childName + "." + fk.name + " needs an exact parent key");
      assert.equal(fk.onDelete, "RESTRICT");
      assert.equal(fk.onUpdate, "RESTRICT");
      for (let position = 0; position < fk.columns.length; position++) {
        const childColumn = child.columns.find(column => column.name === fk.columns[position]);
        const parentColumn = parent.columns.find(column => column.name === fk.referencedColumns[position]);
        assert.ok(childColumn && parentColumn, childName + "." + fk.name + " has an unknown column");
        assert.equal(childColumn.type, parentColumn.type, childName + "." + fk.name + " type mismatch");
      }
    }
  }
});
