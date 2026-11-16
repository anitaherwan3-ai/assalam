"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { evaluateCutoverReadiness } = require("../lib/cutover-readiness");

const manifestPath = path.join(__dirname, "..", "config", "tidb-cutover-gates.json");
let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
} catch (error) {
  process.stderr.write("Cutover readiness blocked: manifest cannot be read or parsed.\n");
  process.exitCode = 2;
  return;
}

const result = evaluateCutoverReadiness(manifest);
if (result.ready) {
  process.stdout.write("CUTOVER READY: all required gates have evidence and explicit owner approval.\n");
} else {
  process.stdout.write("CUTOVER BLOCKED (" + result.blockers.length + " blockers):\n");
  for (const blocker of result.blockers) process.stdout.write("- " + blocker + "\n");
  process.exitCode = 1;
}
