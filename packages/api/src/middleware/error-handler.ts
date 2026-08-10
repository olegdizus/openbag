export function errorMiddleware() {
  return async (c: any, next: () => Promise<void>) => {
    try {
      await next();
    } catch (err) {
      // Log the real error (with message) for operators, but return a generic
      // message to the client (M4) — raw err.message can leak SQL errors,
      // internal paths, or type details that aid an attacker.
      console.error("API error:", err);
      return c.json({ error: { code: 500, message: "Internal server error" } }, 500);
    }
  };
}
