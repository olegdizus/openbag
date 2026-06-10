export function developerRoutes() {
  const app = new (require("hono").Hono)();
  app.get("/developer", (c) => c.html("<h1>OAuth Developer</h1>"));
  return app;
}
