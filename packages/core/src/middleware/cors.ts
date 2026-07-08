// CORS middleware

export function corsMiddleware() {
  return async (c: any, next: () => Promise<void>) => {
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (c.req.method === "OPTIONS") {
      return new Response(null, { status: 204 });
    }

    await next();
  };
}
