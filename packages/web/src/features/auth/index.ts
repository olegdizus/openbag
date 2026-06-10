export function loginRoutes() {
  const app = new (require("hono").Hono)();
  app.get("/login", (c) => c.html("<h1>Login</h1><form method='post' action='/login'><input name='username'/><input name='password'/><button type='submit'>Login</button></form>"));
  app.post("/login", async (c) => c.json({ success: true }));
  return app;
}
