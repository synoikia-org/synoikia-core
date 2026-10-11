# auth/

Admin auth (local argon2id users, TOTP, OIDC, sessions, CSRF, lockout) and MCP client auth (the
methods `bearer`, `oauth` and `external`, enabled globally and narrowed per endpoint; the built-in OAuth 2.1
authorization server; `external.ts` is the external provider harness, with Cloudflare Access in
`external-cloudflare.ts`). Every
credential resolves to an enabled owner whose role must have the endpoint; roles and self-registration
are in `roles.ts` and `users.ts`, and the Admin API is admin-only outside `/api/profile` and `/api/me`.

Design: [`docs/design/06-authentication.md`](../../../../docs/design/06-authentication.md) §6 (roles §6.4, self-registration §6.5).
