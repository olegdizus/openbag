export function entryWebRoutes() {
  const app = new (require("hono").Hono)();
  app.get("/entries", (c) => c.html("<h1>Entries</h1>"));
  return app;
}
