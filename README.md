# Atlas-o-meter

Atlas-o-meter is a private, shared behaviour calendar and star reward tracker for me and the wife. It is designed for Android phones, can be installed as a home-screen app, and stores both users' changes in one SQLite database.

The two personalised mood portraits are generated illustration derivatives. The source family photos are not copied into the repository. The WebP files live outside `public/` and are delivered only to an authenticated session through a private, `no-store` API response.

## What it does

- Shows a Monday-to-Sunday week with happy and tricky moments represented by two personalised illustrated faces.
- Adds, edits, and removes behaviour entries while recording who created and last updated them.
- Assigns zero or one optional reusable tag to each entry, with filtering and existing-tag suggestions.
- Gives one progress face for a happy moment, removes one for a later tricky moment without ever going below zero, and awards one automatic star for every ten progress faces.
- Lets either parent add, rename, complete, reopen, or remove a shared skill; a completion contributes five progress faces and all changes are shared between phones.
- Records append-only star corrections and reward spending separately from automatic progress.
- Shows week, month, and quarter history with happy/tricky and skill-completion totals, signed automatic-star movement, opening and closing balances, trends, and period breakdowns.
- Plays a brief illustrated celebration after a happy face is saved, with an extra star treatment when the save crosses a ten-face milestone.
- Refreshes shared data after changes, on focus/reconnection, and every 12 seconds while visible.
- Installs as a production PWA. Writes require a connection; family data and API responses are never put in the service-worker cache.
- Protects access with Edward's Google identity verification, Lisa's salted scrypt password credential, optional passkeys, same-origin checks, rate limits, and signed 30-day sessions.

See [the product specification](docs/product-spec.md) for the detailed behavior rules.

## Local development

Requirements:

- Node.js 24 or newer
- pnpm 11.20.0, as declared in `package.json`

```bash
corepack enable
cp .env.example .env.local
pnpm install --frozen-lockfile
pnpm dev
```

For local development, set these values in `.env.local`:

```dotenv
APP_ORIGIN=http://localhost:3000
WEBAUTHN_ORIGIN=http://localhost:3000
WEBAUTHN_RP_ID=localhost
ATLAS_EDWARD_EMAIL=<approved-Edward-Google-email>
GOOGLE_CLIENT_ID=<Google-Web-client-ID>
GOOGLE_CLIENT_SECRET=<Google-Web-client-secret>
```

Create a Google **Web application** OAuth client with `http://localhost:3000` as an authorised JavaScript origin and `http://localhost:3000/api/auth/google/callback` as an authorised redirect URI.

Replace the example `SESSION_SECRET` with at least 32 random characters before relying on sessions. `openssl rand -base64 32` can generate one. The database defaults to `./data/atlas.db`; its directory and schema are created on first use. Local database and environment files are ignored by Git.

## Configuration

| Variable                                   | Purpose                                           | Production requirement                          |
| ------------------------------------------ | ------------------------------------------------- | ----------------------------------------------- |
| `DATABASE_PATH`                            | SQLite file                                       | Compose sets `/data/atlas.db`                   |
| `SESSION_SECRET`                           | HMAC key for signed session cookies               | Required; at least 32 characters                |
| `APP_ORIGIN`                               | Public OIDC callback and accepted mutation origin | Your HTTPS application origin                   |
| `WEBAUTHN_ORIGIN`                          | Exact passkey origin, with no trailing slash      | Same as `APP_ORIGIN`                            |
| `WEBAUTHN_RP_ID`                           | Passkey relying-party hostname only               | Hostname from `APP_ORIGIN`                      |
| `ATLAS_EDWARD_EMAIL`                       | Edward's exact Google email allowlist entry       | Required server-side                            |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Web application OAuth credentials          | Required server-side; never use `NEXT_PUBLIC_*` |
| `NPM_NETWORK`                              | Shared reverse-proxy Docker network               | Only when using `docker-compose.npm.yml`        |

Week boundaries and displayed times use each phone's browser timezone. Keep both household phones set to `Europe/London` for consistent dates around midnight and daylight-saving changes.

Keep Google OpenID Connect, WebAuthn, reverse-proxy, and hosting details in a private deployment runbook outside this repository.

## Quality checks

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Use `pnpm test:watch` during development. If the SVG artwork changes, regenerate the committed PNG PWA icons with `pnpm generate:icons`.

## Docker deployment

The production image is a Next.js standalone build on Node 24. The base Compose file runs exactly one application container and persists SQLite in `atlas_data`. Configure the bind address and reverse proxy in the private deployment environment, not in this repository.

```bash
cp .env.example .env
# Replace every placeholder and keep this file private.
chmod 600 .env
docker compose up --build -d
docker compose ps
curl --fail http://127.0.0.1:3000/api/health/ready
```

Configure the chosen reverse proxy to forward the private application listener to the app container. Keep deployment-specific hostnames, addresses, and proxy configuration in the private deployment environment. Follow [docs/deployment.md](docs/deployment.md) before starting a public deployment.

This SQLite design is intentionally **single-instance**. Do not scale the app service to multiple containers or mount the database on multiple hosts. WAL mode and a five-second busy timeout support this two-user workload within one process; they are not a distributed database strategy.

Create a consistent online backup inside the persistent volume with:

```bash
docker compose exec app node scripts/backup-db.mjs
```

The default destination is `/data/backups/atlas-<timestamp>.db`. The script uses SQLite's online backup operation, checks the result, refuses overwrite, and publishes the file with mode `0600`. Copy backups to separate protected storage and periodically test restoration. Passkey public credentials and Lisa's salted password hash are stored in this database, so restoring only behaviour rows is not a complete authentication restore. Edward can use Google to enrol another passkey; Lisa can use her restored password or have Edward replace it. A password replacement does not revoke Lisa's existing sessions or passkeys.

The health endpoints are:

- `GET /api/health/live`: process liveness; does not touch the database.
- `GET /api/health/ready`: database readiness; Compose uses this endpoint.

## Install on Android

After the app is available over HTTPS, Edward signs in with his configured Google account and sets Lisa's Atlas password in Settings. Lisa signs in with that password. Each person can then optionally set up phone unlock. Open **Settings** and use **Add to home screen** when Chrome offers it. If no in-app install button appears, use Chrome's **Install app** or **Add to Home screen** menu item.

Each person should enrol a passkey only while signed in as themselves. If a passkey is unavailable, cancelled, forgotten by the browser, or being set up on a new phone, Edward uses **Sign in with Google instead** and Lisa uses her password. Android chooses whether user verification is a fingerprint, face check, device PIN/pattern, or saved passkey; the site cannot promise a particular biometric.

## Documentation

- [Product specification](docs/product-spec.md)
- [Architecture](docs/architecture.md)
- [Data model](docs/data-model.md)
- [Deployment runbook](docs/deployment.md)
- [Roadmap](docs/roadmap.md)
- [Testing](docs/testing.md)
