import { Hono } from "hono";
import { layout, escapeHtml } from "../../templates/layout";
import {
  createClient,
  listClients,
  deleteClient,
} from "@openbag/auth";

type ClientRow = {
  id: number;
  random_id: string;
  secret: string;
  name: string;
  redirect_uris: string;
  allowed_grant_types: string;
  created_at: string;
};

function parseJsonArray(raw: string | undefined | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function developerRoutes() {
  const app = new Hono();

  app.get("/", async (c) => {
    const sessionUser = c.get("user") as { id: number; username: string } | undefined;
    if (!sessionUser) return c.redirect("/login", 302);
    const clients = await listClients(c.env, sessionUser.id) as ClientRow[];

    const items = clients.map((cl) => {
      return {
        id: cl.id,
        client_id: `${cl.id}_${cl.random_id}`,
        client_secret: cl.secret,
        name: cl.name,
        redirect_uris: parseJsonArray(cl.redirect_uris),
        allowed_grant_types: parseJsonArray(cl.allowed_grant_types),
        created_at: cl.created_at,
      };
    });

    const createdName = c.req.query("created");
    const createdSecret = c.req.query("secret");
    const createdId = c.req.query("client_id");
    const createdAlert = createdId && createdSecret
      ? `      <div class="alert alert-success" role="status">
        <p><strong>Client created.</strong> Store the secret securely — it will not be shown again.</p>
        <p><strong>Client ID:</strong> <code>${escapeHtml(createdId)}</code></p>
        <p><strong>Client Secret:</strong> <code>${escapeHtml(createdSecret)}</code></p>
        ${createdName ? `<p>Name: ${escapeHtml(createdName)}</p>` : ""}
      </div>`
      : "";

    const cards = items.length === 0
      ? `      <p class="text-muted">No clients yet.</p>`
      : items.map((cl) => `      <article class="client-card">
        <h3>${escapeHtml(cl.name)}</h3>
        <div class="cred-row">
          <strong>Client ID</strong>
          <code>${escapeHtml(cl.client_id)}</code>
          <button type="button" class="btn-sm" data-copy="${escapeHtml(cl.client_id)}">Copy</button>
        </div>
        <div class="cred-row">
          <strong>Client Secret</strong>
          <code>${escapeHtml(cl.client_secret)}</code>
          <button type="button" class="btn-sm" data-copy="${escapeHtml(cl.client_secret)}">Copy</button>
        </div>
        <div class="client-actions">
          <form method="post" action="/developer/client/delete/${cl.id}" data-enhance data-confirm="Delete client ${escapeHtml(cl.name)}?">
            <button type="submit" class="btn-danger">Delete</button>
          </form>
          ${cl.created_at ? `<span class="text-muted">Created ${escapeHtml(new Date(cl.created_at).toLocaleDateString())}</span>` : ""}
        </div>
      </article>`).join("\n");

    return c.html(layout({
      title: "Developer",
      user: sessionUser,
      body: `${createdAlert}      <h1>OAuth Clients</h1>
      <a href="/developer/client/new" class="btn-create">+ Create new client</a>
${cards}`,
    }));
  });

  app.get("/client/new", (c) => {
    const sessionUser = c.get("user") as { id: number; username: string } | undefined;
    if (!sessionUser) return c.redirect("/login", 302);
    return c.html(layout({
      title: "Create OAuth Client",
      user: sessionUser,
      body: `      <h1>Create OAuth Client</h1>
      <form method="post" action="/developer/client/create">
        <fieldset>
          <label for="cl-name">Name</label>
          <input id="cl-name" type="text" name="name" required/>
        </fieldset>
        <fieldset>
          <label for="cl-redirect">Redirect URIs (comma separated)</label>
          <input id="cl-redirect" type="text" name="redirect_uris" value="http://localhost"/>
        </fieldset>
        <button type="submit">Create</button>
      </form>
      <p><a href="/developer">Back</a></p>`,
    }));
  });

  app.post("/client/create", async (c) => {
    const sessionUser = c.get("user") as { id: number; username: string } | undefined;
    if (!sessionUser) return c.redirect("/login", 302);
    const body = await c.req.parseBody();
    const name = typeof body.name === "string" ? body.name : "Unnamed";
    const redirectUrisRaw = typeof body.redirect_uris === "string" ? body.redirect_uris : "http://localhost";
    const redirectUris = redirectUrisRaw.split(",").map(s => s.trim()).filter(Boolean);
    const allowedGrantTypes = ["token", "authorization_code", "password", "refresh_token"];
    const client = await createClient(c.env, sessionUser.id, name, redirectUris, allowedGrantTypes) as { id: number; random_id: string; secret: string };

    // PRG with flash: secret shown once via query string.
    const params = new URLSearchParams({
      client_id: `${client.id}_${client.random_id}`,
      secret: client.secret,
      created: name,
    });
    return c.redirect(`/developer?${params.toString()}`, 302);
  });

  app.post("/client/delete/:id", async (c) => {
    const sessionUser = c.get("user") as { id: number; username: string } | undefined;
    if (!sessionUser) return c.redirect("/login", 302);
    const id = parseInt(c.req.param("id"));
    await deleteClient(c.env, sessionUser.id, id);
    if (c.req.header("X-Requested-With") === "XMLHttpRequest") {
      return c.html("");
    }
    return c.redirect("/developer", 302);
  });

  return app;
}
