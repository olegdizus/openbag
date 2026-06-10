export function developerRoutes() {
  const app = new (require("hono").Hono)();
  // Developer routes are handled by authRoutes() in @wallabag/auth
  return app;
}
