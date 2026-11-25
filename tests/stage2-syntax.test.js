"use strict";

const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("Stage 2 changed JavaScript files parse without syntax errors", () => {
  const files = [
    "js/app.js",
    "js/tidb-api.js",
    "api/inventory.js",
    "api/sales.js",
    "lib/clinic-domain-commands.js"
  ];
  for (const relativePath of files) {
    const absolutePath = path.join(__dirname, "..", relativePath);
    const source = fs.readFileSync(absolutePath, "utf8");
    assertScript(relativePath, source);
  }
});

function assertScript(filename, source) {
  new vm.Script(source, { filename });
}
