"use strict";

let authPromise;

function requiredEnv(name, minLength = 1) {
  const value = String(process.env[name] || "").trim();
  if (value.length < minLength) {
    const error = new Error("Authentication configuration is incomplete.");
    error.code = "AUTH_CONFIG_MISSING";
    error.configKey = name;
    throw error;
  }
  return value;
}

async function getBetterAuth() {
  if (!authPromise) {
    authPromise = (async () => {
      const { betterAuth } = await import("better-auth");
      const { admin } = await import("better-auth/plugins");
      const { getPool } = require("./tidb");
      const baseURL = requiredEnv("BETTER_AUTH_URL");
      const secret = requiredEnv("BETTER_AUTH_SECRET", 32);
      const extraOrigins = String(process.env.BETTER_AUTH_TRUSTED_ORIGINS || "")
        .split(",").map(value => value.trim()).filter(Boolean);
      const trustedOrigins = [...new Set([new URL(baseURL).origin, ...extraOrigins])];

      return betterAuth({
        database: getPool(),
        baseURL,
        secret,
        trustedOrigins,
        emailAndPassword: {
          enabled: true,
          disableSignUp: true,
          minPasswordLength: 12,
          maxPasswordLength: 128
        },
        session: {
          expiresIn: 60 * 60 * 12,
          updateAge: 60 * 60 * 4
        },
        rateLimit: {
          enabled: true,
          storage: "database",
          modelName: "rateLimit",
          window: 60,
          max: 30,
          customRules: {
            "/sign-in/email": { window: 60, max: 5 },
            "/sign-up/email": { window: 60, max: 1 }
          }
        },
        plugins: [admin({ defaultRole: "user", adminRoles: ["admin"], allowImpersonatingAdmins: false })],
        advanced: {
          useSecureCookies: true,
          defaultCookieAttributes: {
            httpOnly: true,
            secure: true,
            sameSite: "lax"
          }
        }
      });
    })().catch(error => {
      authPromise = null;
      throw error;
    });
  }
  return authPromise;
}

module.exports = { getBetterAuth };
