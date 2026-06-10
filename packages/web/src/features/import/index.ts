export function importRoutes() {
  const app = new (require("hono").Hono)();
  app.get("/import", (c) => c.html("<h1>Import</h1>"));
  return app;
}
