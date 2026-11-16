"use strict";

const mysql = require("mysql2/promise");

let pool;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    const error = new Error("Missing required database configuration");
    error.code = "DB_CONFIG_MISSING";
    error.configKey = name;
    throw error;
  }
  return String(value).trim();
}

function getPool() {
  if (pool) return pool;

  const portValue = requiredEnv("TIDB_PORT");
  const port = Number(portValue);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    const error = new Error("Invalid database port configuration");
    error.code = "DB_CONFIG_INVALID";
    throw error;
  }

  pool = mysql.createPool({
    host: requiredEnv("TIDB_HOST"),
    port,
    user: requiredEnv("TIDB_USER"),
    password: requiredEnv("TIDB_PASSWORD"),
    database: requiredEnv("TIDB_DATABASE"),
    waitForConnections: true,
    connectionLimit: 3,
    supportBigNumbers: true,
    bigNumberStrings: true,
    maxIdle: 1,
    idleTimeout: 30000,
    queueLimit: 0,
    connectTimeout: 10000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    // TiDB Cloud Starter requires TLS for public connections.
    // Its server certificate is trusted by Node.js' built-in CA store.
    ssl: {
      minVersion: "TLSv1.2"
    }
  });

  return pool;
}

module.exports = { getPool };
