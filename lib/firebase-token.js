"use strict";

const crypto = require("node:crypto");

const CERT_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
const certCache = new Map();
const accountStatusCache = new Map();

function unauthorized(message, code = "AUTH_TOKEN_INVALID") {
  const error = new Error(message);
  error.statusCode = 401;
  error.code = code;
  return error;
}

function decodeSegment(segment) {
  if (typeof segment !== "string" || !/^[A-Za-z0-9_-]+$/.test(segment)) {
    throw unauthorized("Invalid Firebase ID token encoding.");
  }
  try {
    return Buffer.from(segment, "base64url");
  } catch (_) {
    throw unauthorized("Invalid Firebase ID token encoding.");
  }
}

function parseJsonSegment(segment) {
  try {
    return JSON.parse(decodeSegment(segment).toString("utf8"));
  } catch (error) {
    if (error && error.statusCode === 401) throw error;
    throw unauthorized("Invalid Firebase ID token payload.");
  }
}

async function resolveGoogleCertificate(kid) {
  const now = Date.now();
  const cached = certCache.get(kid);
  if (cached && cached.expiresAt > now) return cached.publicKey;

  const response = await fetch(CERT_URL, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) {
    const error = new Error("Firebase signing certificates are temporarily unavailable.");
    error.statusCode = 503;
    error.code = "AUTH_CERTS_UNAVAILABLE";
    throw error;
  }
  const certs = await response.json();
  const cert = certs && certs[kid];
  if (!cert) throw unauthorized("Unknown Firebase signing key.");
  const publicKey = crypto.createPublicKey(cert);
  const cacheControl = response.headers.get("cache-control") || "";
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const maxAgeSeconds = maxAgeMatch ? Math.min(Number(maxAgeMatch[1]), 3600) : 300;
  certCache.set(kid, { publicKey, expiresAt: now + Math.max(60, maxAgeSeconds) * 1000 });
  return publicKey;
}
 
async function resolveFirebaseAccountStatus(token, projectId, uid) {
  const cacheKey = projectId + ":" + uid;
  const cached = accountStatusCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.account;

  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  if (!apiKey) {
    const error = new Error("Firebase account-status verification is not configured.");
    error.statusCode = 503;
    error.code = "AUTH_ACCOUNT_STATUS_NOT_CONFIGURED";
    throw error;
  }
  const response = await fetch(
    "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + encodeURIComponent(apiKey),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: token }),
      signal: AbortSignal.timeout(5000)
    }
  );
  if (!response.ok) {
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      throw unauthorized("Firebase account is invalid or no longer active.");
    }
    const error = new Error("Firebase account-status service is temporarily unavailable.");
    error.statusCode = 503;
    error.code = "AUTH_ACCOUNT_STATUS_UNAVAILABLE";
    throw error;
  }
  const payload = await response.json();
  const users = payload && payload.users;
  if (!Array.isArray(users) || users.length !== 1 || !users[0] ||
      typeof users[0].localId !== "string" || typeof users[0].disabled !== "boolean" ||
      !Number.isFinite(Number(users[0].validSince))) {
    const error = new Error("Firebase account-status response is incomplete.");
    error.statusCode = 503;
    error.code = "AUTH_ACCOUNT_STATUS_INCOMPLETE";
    throw error;
  }
  const user = users[0];
  const account = {
    uid: user.localId,
    disabled: user.disabled,
    validSince: Number(user.validSince),
    email: typeof user.email === "string" ? user.email.toLowerCase() : null
  };
  accountStatusCache.set(cacheKey, { account, expiresAt: Date.now() + 30000 });
  return account;
}

async function verifyFirebaseIdToken(token, projectId, options = {}) {
  if (typeof token !== "string" || token.length < 100 || token.length > 10000) {
    throw unauthorized("Firebase ID token is missing or malformed.");
  }
  if (!projectId || typeof projectId !== "string") {
    const error = new Error("Firebase project verification is not configured.");
    error.statusCode = 503;
    error.code = "AUTH_PROJECT_NOT_CONFIGURED";
    throw error;
  }

  const parts = token.split(".");
  if (parts.length !== 3) throw unauthorized("Malformed Firebase ID token.");
  const header = parseJsonSegment(parts[0]);
  const claims = parseJsonSegment(parts[1]);
  if (!header || header.alg !== "RS256" || typeof header.kid !== "string" ||
      (header.typ && header.typ !== "JWT")) {
    throw unauthorized("Unsupported Firebase ID token signature.");
  }

  const publicKey = options.resolvePublicKey
    ? await options.resolvePublicKey(header.kid)
    : await resolveGoogleCertificate(header.kid);
  const signingInput = Buffer.from(parts[0] + "." + parts[1], "utf8");
  const signature = decodeSegment(parts[2]);
  const validSignature = crypto.verify("RSA-SHA256", signingInput, publicKey, signature);
  if (!validSignature) throw unauthorized("Firebase ID token signature is invalid.");

  const now = Math.floor((options.nowMs === undefined ? Date.now() : options.nowMs) / 1000);
  const issuer = "https://securetoken.google.com/" + projectId;
  if (claims.aud !== projectId || claims.iss !== issuer ||
      typeof claims.sub !== "string" || claims.sub.length < 1 || claims.sub.length > 128 ||
      !Number.isFinite(claims.exp) || !Number.isFinite(claims.iat) ||
      claims.exp <= now - 60 || claims.iat > now + 60 || claims.exp <= claims.iat ||
      !Number.isFinite(claims.auth_time) || claims.auth_time > now + 60) {
    throw unauthorized("Firebase ID token claims are invalid.");
  }

  const account = options.resolveAccountStatus
    ? await options.resolveAccountStatus(token, projectId, claims)
    : await resolveFirebaseAccountStatus(token, projectId, claims.sub);
  if (!account || account.uid !== claims.sub || account.disabled === true ||
      !Number.isFinite(account.validSince) || account.validSince > claims.auth_time ||
      (account.email && claims.email && account.email !== String(claims.email).toLowerCase())) {
    throw unauthorized("Firebase account is disabled, revoked, or does not match its ID token.", "AUTH_ACCOUNT_REVOKED");
  }

  return Object.freeze({
    uid: claims.sub,
    email: typeof claims.email === "string" ? claims.email.toLowerCase() : null,
    emailVerified: claims.email_verified === true,
    issuedAt: claims.iat,
    expiresAt: claims.exp,
    authTime: Number.isFinite(claims.auth_time) ? claims.auth_time : null
  });
}

module.exports = { verifyFirebaseIdToken };
