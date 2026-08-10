# Contributing to OpenBag

Thanks for your interest in contributing! OpenBag is a from-scratch,
API-compatible reimplementation of the Wallabag v2 API that runs entirely on
Cloudflare Workers + D1.

## Development setup

See the [README](README.md) for the full install, database, and run flow. Short version:

```bash
pnpm install
pnpm db:migrate:local
pnpm dev
```

## Before opening a pull request

1. `pnpm typecheck` passes
2. `pnpm test` passes
3. `pnpm build` is green
4. Keep one concern per PR — focused diffs review faster.

## Code style

- TypeScript strict mode. Avoid `any`; if unavoidable, say why in a comment.
- [Conventional Commits](https://www.conventionalcommits.org/) messages
  (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `style:`).
- Prefer the standard library and existing helpers over new dependencies.
- Server source for the UI Worker is TypeScript/TSX; client-side enhancements
  are native Web Components — no framework, no build step beyond esbuild.

## Reporting bugs

Open an [issue](https://github.com/oleg-deezus/wallabag_cf_worker/issues) with
enough detail to reproduce: the request, the response, the affected endpoint,
and the Worker logs if you have them. Remember OpenBag runs on the Cloudflare
Workers runtime, not Node.js.

## Security issues

Do **not** open a public issue for security vulnerabilities — see
[SECURITY.md](SECURITY.md).

## License

By contributing, you agree your contributions are licensed under the
[MIT License](LICENSE).
