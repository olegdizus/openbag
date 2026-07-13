#!/usr/bin/env tsx
//
// Out-of-band user provisioning for when registration is disabled.
//
// Runs locally (Node 20+) and shells out to `wrangler d1 execute`, so it never
// goes through the Worker — the registration flag cannot block it. Password
// hashing reuses the exact pure-Web-Crypto module the Worker uses, so hashes
// are compatible.
//
// Usage:
//   pnpm create-user --username alice --password 's3cret!' [--email a@b.c] [--local]
//
//   --local    target the local miniflare D1 (wrangler dev). Default: --remote.

import { spawnSync } from "node:child_process";
import { hashPassword } from "../worker/src/auth/features/users/password";

interface Args {
  username: string;
  password: string;
  email: string | null;
  local: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { username: "", password: "", email: null, local: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--username": out.username = next(); break;
      case "--password": out.password = next(); break;
      case "--email": out.email = next(); break;
      case "--local": out.local = true; break;
      case "--remote": out.local = false; break;
      case "--help":
      case "-h":
        console.log(`Usage: pnpm create-user --username <name> --password <pw> [--email <addr>] [--local|--remote]`);
        process.exit(0);
      default:
        if (a.startsWith("--username=")) out.username = a.slice("--username=".length);
        else if (a.startsWith("--password=")) out.password = a.slice("--password=".length);
        else if (a.startsWith("--email=")) out.email = a.slice("--email=".length);
        else console.warn(`Ignoring unknown arg: ${a}`);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.username || args.username.length < 3) {
    console.error("Error: --username is required (min 3 characters).");
    process.exit(1);
  }
  if (!args.password || args.password.length < 8) {
    console.error("Error: --password is required (min 8 characters).");
    process.exit(1);
  }

  const hash = await hashPassword(args.password);

  // Two statements in one execute call: insert the user, then seed their config.
  const emailSql = args.email ? `'${args.email.replace(/'/g, "''")}'` : "NULL";
  const usernameEsc = args.username.replace(/'/g, "''");
  const sql = [
    `INSERT INTO users (username, email, password_hash) VALUES ('${usernameEsc}', ${emailSql}, '${hash}');`,
    `INSERT INTO user_config (user_id) SELECT id FROM users WHERE username = '${usernameEsc}';`,
  ].join(" ");

  const target = args.local ? "--local" : "--remote";
  console.log(`Provisioning user "${args.username}" (${target})…`);

  const result = spawnSync(
    "wrangler",
    ["d1", "execute", "DB", target, "--command", sql],
    { stdio: "inherit", shell: process.platform === "win32" }
  );

  if (result.status !== 0) {
    console.error("Failed: wrangler d1 execute exited non-zero.");
    process.exit(result.status ?? 1);
  }
  console.log(`Done. User "${args.username}" created.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
