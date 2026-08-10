export function corsMiddleware() {
  return async (c: any, next: () => Promise<void>) => {
    // Reflect the request Origin (when present) instead of `*` (L2): wildcard
    // CORS combined with a leaked `?access_token=` query token lets a
    // third-party site read API responses. Reflecting Origin is safe here —
    // cookie auth stays cross-site blocked (no Allow-Credentials) and native
    // Wallabag clients don't send Origin.
    const origin = c.req.header("origin");
    if (origin) c.header("Access-Control-Allow-Origin", origin);
    c.header("Vary", "Origin");
    c.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (c.req.method === "OPTIONS") {
      return new Response(null, { status: 204 });
    }

    await next();
  };
}
