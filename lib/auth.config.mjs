const betterAuthModule = await import("./better-auth.js");
export const auth = await betterAuthModule.default.getBetterAuth();
export default auth;
