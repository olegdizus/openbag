# Security Policy

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Report privately using one of:

- GitHub's private vulnerability reporting at
  <https://github.com/oleg-deezus/openbag/security/advisories/new>, **or**
- Email **olegdizus@gmail.com** with details and reproduction steps.

Please allow up to 72 hours for an initial response. We will coordinate a fix
and disclosure timeline with you.

## Scope

OpenBag is self-hosted on Cloudflare Workers + D1. In scope:

- Authentication and OAuth2 token handling (`/oauth/*`, sessions).
- The article fetch & sanitization pipeline.
- SQL / D1 query construction.
- Cross-origin `/ui/*` form handling and CSRF defenses.

Out of scope: third-party Wallabag clients, the Cloudflare platform itself, and
issues already publicly disclosed.

## Supported versions

Only the latest `main` branch receives security fixes.
