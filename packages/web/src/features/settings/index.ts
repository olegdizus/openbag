export function settingsRoutes() {
  const app = new (require("hono").Hono)();
  app.get("/settings", (c) => c.html("<h1>Settings</h1>"));
  return app;
}
