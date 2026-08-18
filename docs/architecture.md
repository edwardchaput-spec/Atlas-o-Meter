# Architecture

## Overview

Atlas-o-meter is a single Next.js application with a client-rendered mobile interface, server route handlers, and a local SQLite database. Both phones talk to the same server, and that one application process is the only process that opens the database.

| Layer         | Implementation                          | Responsibility                                                                                                                   |
| ------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| UI            | React 19 client components and date-fns | Week calendar, shared skills, history, illustrated celebrations, password/passkey prompts, behavior/reward forms, and sync state |
| Web/API       | Next.js 16 App Router on Node 24        | Server rendering, Google/password/passkey authentication, signed sessions, validation, JSON routes, and security headers         |
| Domain        | TypeScript and Zod                      | Input schemas, tag/skill normalisation, ordered progress events, history windows, and star calculations                          |
| Persistence   | better-sqlite3                          | Migrations, transactions, behaviours, skills, rewards, authentication state, audit fields, and reporting                         |
| External auth | Google OpenID Connect and WebAuthn      | Edward's Google identity proof and cryptographic returning-device authentication for either person                               |
| Runtime       | Standalone Next.js Docker image         | One container behind Nginx Proxy Manager and HTTPS                                                                               |

## Authentication flow

1. The server-rendered root page checks the signed session cookie. A valid session opens the app directly; otherwise the client shows the Edward/Lisa identity selector.
2. If that browser remembers a passkey for the selected identity, it offers phone unlock first. Otherwise Edward sees **Continue with Google** and Lisa sees her Atlas password form, with an explicit phone-unlock option whenever WebAuthn is supported. This keeps an existing or synced passkey reachable after browser storage is cleared. Cancelling or failing phone unlock exposes the same identity-specific fallback.
3. Edward's `POST /api/auth/google/start` validates the fixed Edward actor and same-origin request, applies the rate limit, and asks `openid-client` to build a Google authorization-code request. The request uses only `openid email`, PKCE S256, state, nonce, and the fixed callback. The route rejects Lisa rather than starting Google authentication for her.
4. Atlas stores Edward, state, nonce, PKCE verifier, and a ten-minute expiry in the migration-3 `google_auth_challenges` table. The browser receives the Google authorization URL plus an HTTP-only challenge-ID cookie; it never supplies a trusted email or redirect target.
5. Google redirects to `GET /api/auth/google/callback`. The server atomically consumes the challenge and compares state before exchanging the code. `openid-client` verifies the ID token's signature, issuer, audience/client ID, expiry, and nonce. Atlas additionally requires `email_verified === true` and an exact match with `ATLAS_EDWARD_EMAIL`.
6. Lisa's `POST /api/auth/password/login` accepts only `{ username: "lisa", password }`, applies a persistent limit of ten attempts per 15 minutes, and verifies the submitted value against her stored scrypt credential. A successful verification clears the bucket; an unset credential or wrong password returns the same safe failure without creating a session.
7. A successful Google callback or Lisa password verification creates the same signed 30-day Atlas session and offers passkey enrolment. Google redirects only through `/auth/google/complete` to `/?passkey=offer`, breaking the cross-site redirect chain so the new Atlas cookie can remain SameSite Strict. Password login is already same-origin and can offer enrolment directly.
8. Passkey registration requires an authenticated session for the identity receiving the credential. The server stores a single-use five-minute challenge in SQLite and a challenge identifier in a short-lived HTTP-only cookie. Android performs user verification and returns a signed WebAuthn response.
9. Future passkey login repeats the challenge/response flow without Google or a password. The server verifies the expected origin, relying-party ID, credential public key, signature counter, and user-verification result before creating the same session. Counter persistence uses a compare-and-swap against the value that was verified so a stale concurrent response cannot regress a nonzero counter. Google remains Edward's fallback; Lisa's password remains hers.

An authenticated Edward manages Lisa's password through `GET` and `PUT /api/settings/lisa-password`. `GET` returns only `{ configured, updatedAt }`. `PUT` strictly validates `{ password }`, preserves password whitespace, and requires 12–128 characters with at least one non-whitespace character. It derives a 64-byte key with Node's asynchronous scrypt using a fresh 16-byte salt and `N=32768`, `r=8`, and `p=1`; only the hash, salt, algorithm parameters, Edward audit value, and timestamps are persisted. Saving the credential atomically clears any existing Lisa password lockout. The server never logs or returns the submitted password, salt, or hash. Lisa and unauthenticated callers are rejected server-side, and Edward's existing session is sufficient without extra step-up authentication.

Atlas-o-meter never receives a fingerprint, face scan, device PIN, or other biometric secret. Those remain inside Android or its passkey provider. SQLite stores the credential ID, public key, counter, transport metadata, device type, backup flag, and audit timestamps.

Atlas never receives Edward's Google password and does not persist Google access tokens, refresh tokens, or ID tokens. Google is used only to prove Edward's identity during the callback. Gmail APIs and mailbox scopes are not requested. Lisa's Atlas-specific password is unrelated to Gmail and is represented in SQLite only by its salted scrypt hash.

Authentication throttling is server-side and persisted in SQLite:

- at most ten Edward Google sign-in starts per ten minutes;
- at most ten Edward Google callbacks per ten minutes;
- at most ten Lisa password attempts per 15 minutes, with the shared bucket cleared after success or password replacement;
- at most thirty passkey starts per identity per ten minutes.

Google can impose additional provider-side controls. Atlas deliberately does not make IP address a household identity signal because it operates behind Nginx Proxy Manager.

## Data and sync flow

1. After authentication, the client requests `/api/dashboard` for the selected Monday-to-Sunday range.
2. The API validates the session and range, queries weekly entries plus global tags, active skills, stars, and adjustment history, and responds with `Cache-Control: no-store`.
3. A mutation validates origin, session, JSON shape, and domain constraints before executing one immediate SQLite transaction.
4. Either authenticated actor can create, rename, complete, reopen, or soft-delete a skill. Creates converge on an equivalent active normalised name; updates/deletes use an expected version to detect changes from the other phone.
5. The client reloads the dashboard after a successful mutation. It also refreshes every 12 seconds while visible, on window focus, after reconnection, and on request, so the Skills section and star summary share the same cross-phone refresh path as the calendar.
6. Saving a happy behavior triggers a brief, decorative client-side portrait celebration. If the mutation crossed an automatic ten-face boundary, the celebration includes a star and the interface announces the award.
7. The History tab requests up to 100 days from `/api/history`. The server returns ordered active happy/tricky and skill-completion progress facts, star adjustments in the range, and the derived opening state. The client groups those facts into days for a week, Monday-based partial weeks for a month, or months for a quarter.

Polling is deliberate for this household-scale deployment: it requires no message broker or long-lived connection, and the maximum normal visibility delay is approximately 12 seconds. Consequently the reverse proxy does not need WebSocket support.

## Server interfaces

| Route                                     | Method   | Purpose                                                                  |
| ----------------------------------------- | -------- | ------------------------------------------------------------------------ |
| `/api/auth/google/start`                  | `POST`   | Start a rate-limited, same-origin Google OIDC transaction                |
| `/api/auth/google/callback`               | `GET`    | Consume the Google callback and create the signed Atlas session          |
| `/auth/google/complete`                   | `GET`    | Break the cross-site chain, then navigate to the app/passkey offer       |
| `/api/auth/password/login`                | `POST`   | Verify Lisa's password under the persistent rate limit and set a session |
| `/api/settings/lisa-password`             | `GET`    | Return password configuration status to authenticated Edward             |
| `/api/settings/lisa-password`             | `PUT`    | Let authenticated Edward set or replace Lisa's write-only password       |
| `/api/auth/passkeys`                      | `GET`    | Return the authenticated identity's passkey count                        |
| `/api/auth/passkeys/register/options`     | `POST`   | Create authenticated WebAuthn registration options and challenge         |
| `/api/auth/passkeys/register/verify`      | `POST`   | Verify and persist a new passkey public credential                       |
| `/api/auth/passkeys/authenticate/options` | `POST`   | Create rate-limited WebAuthn login options and challenge                 |
| `/api/auth/passkeys/authenticate/verify`  | `POST`   | Verify phone unlock and set the session                                  |
| `/api/auth/logout`                        | `POST`   | Clear the session cookie                                                 |
| `/api/avatars/:mood`                      | `GET`    | Return an authenticated happy/tricky WebP with private, no-store caching |
| `/api/dashboard?from=&to=`                | `GET`    | Read at most 32 days of entries plus global dashboard data               |
| `/api/history?from=&to=`                  | `GET`    | Read at most 100 days of progress/star facts plus opening star state     |
| `/api/behaviors`                          | `POST`   | Create an idempotent behavior entry                                      |
| `/api/behaviors/:id`                      | `PATCH`  | Update an entry using its expected version                               |
| `/api/behaviors/:id`                      | `DELETE` | Soft-delete an entry using its expected version                          |
| `/api/skills`                             | `POST`   | Create a shared skill or converge on its active normalised match         |
| `/api/skills/:id`                         | `PATCH`  | Rename, complete, or reopen a skill using its expected version           |
| `/api/skills/:id`                         | `DELETE` | Soft-delete a skill using its expected version                           |
| `/api/stars/adjustments`                  | `POST`   | Append an idempotent correction or reward spend                          |
| `/api/health/live`                        | `GET`    | Report that the server process responds                                  |
| `/api/health/ready`                       | `GET`    | Check that SQLite can answer a query                                     |

All mutation payloads are strict Zod objects: unknown fields are rejected. API errors use stable codes and messages. Behaviour and skill create retries are deduplicated by `(created_by, client_request_id)`. Skill create aliases are persisted even when an equivalent active name converges on another request's canonical row, so a delayed retry remains bound to the original result after later rename/deletion. Behaviour updates/deletes and skill renames/completion changes/deletes compare the supplied version and return a conflict rather than overwriting a change from the other phone.

## Sessions and trust boundary

The application accepts only the fixed actor identifiers `edward` and `lisa`, but selecting a name alone does not authenticate it. The server creates a session only after Google verifies Edward's exact configured email, the password verifier accepts Lisa's submitted password, or WebAuthn verifies a registered credential for the selected identity with user verification. There is no general user table or registration path. Edward has one explicit household-administration capability: any authenticated Edward session may set or replace Lisa's password; the API enforces this regardless of what the client renders.

The session payload contains the actor and expiry and is signed with HMAC-SHA256. Its cookie is HTTP-only, SameSite Strict, scoped to `/`, valid for 30 days, and Secure in production. `SESSION_SECRET` must be at least 32 characters in production. Mutation routes require the `Origin` header and compare it with configured `APP_ORIGIN`, or with the request origin during local development; client-supplied forwarded headers are not trusted.

The Google ceremony makes one narrow cookie exception. `atlas_google_login` contains only an opaque database challenge ID, expires after ten minutes, is HTTP-only and Secure in production, is scoped exactly to `/api/auth/google/callback`, and uses SameSite Lax so it accompanies Google's top-level cross-site callback. The application session and WebAuthn challenge cookies remain SameSite Strict. Callback state is stored server-side, consumed once, and its redirect destination is fixed from `APP_ORIGIN`. Callback redirects are marked `no-store` with a `no-referrer` policy.

WebAuthn origin matching is exact. Production uses the deployment's configured HTTPS origin and its hostname as `WEBAUTHN_RP_ID`; changing either can make existing passkeys unusable. Challenge records are single-use and expire after five minutes.

The server discovers Google's OpenID Provider metadata and performs the authorization-code exchange over outbound HTTPS through `openid-client`. `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `ATLAS_EDWARD_EMAIL` are server-only environment values. The client secret is never sent to the browser, and the callback does not trust browser-supplied identity claims. Lisa has no Google mapping or Google authentication path.

There is currently no remote session-revocation list or passkey deletion interface. Edward recovers through his configured Google account. Lisa falls back to her password, and Edward can replace it if she forgets it. Replacing that password does not revoke Lisa's already-issued 30-day sessions or registered passkeys, so it does not by itself remove access from a lost or compromised phone. Restoring SQLite restores both the password hash and registered public credentials. The generated mood avatars are also inside the authenticated boundary: an unauthenticated request receives `401`.

## Persistence and concurrency

The process lazily creates one global better-sqlite3 connection. Migration 1 creates behaviours, tags, star adjustments, and their indexes. Migration 2 adds passkeys, WebAuthn challenges, and authentication-rate-limit buckets. Additive migration 3 adds short-lived Google authentication challenges. Additive migration 4 adds the Lisa-only password-credential table without inserting a default row. Additive migration 5 adds shared skills, their active-name index, and durable create-request aliases. Migrations run transactionally when a process first opens the database; no migration recreates existing behaviour, star, history, passkey, or authentication data.

The connection enables foreign keys, a five-second busy timeout, and WAL mode for file-backed databases. Repository writes run as immediate transactions. This supports one app process serving the household; it does not support multiple replicas, multiple hosts sharing a database file, or network filesystems.

Behaviour and skill removal are soft deletes so audit data remains. Skills also retain creation, last-update, completion, and version audit data. The partial unique index applies only to active normalised skill names, so an equivalent active create converges while a deleted name can later be added as a new row.

Automatic progress is derived rather than stored as a mutable counter. The repository chronologically folds current progress events from zero: an active happy behaviour adds one, an active tricky behaviour subtracts one without crossing below zero, and each active completed skill adds five at its completion time. Ties use record time, then the stable `happy → skill → tricky → row ID` fallback. Automatic stars are `floor(effective faces / 10)`. Star adjustments remain a separate append-only ledger and are added only after automatic stars are derived. Consequently editing, moving, reclassifying, or deleting an older behaviour, and reopening or deleting a completed skill, consistently recalculates current and reconstructed star state. Renaming a skill does not change progress.

## History projection

The history endpoint returns data rather than pre-rendered chart buckets:

- opening effective-face/star state and adjustment total immediately before the requested range;
- each ordered active happy/tricky behaviour or completed-skill progress event within the range;
- each correction/reward delta and timestamp within the range;
- a server synchronization timestamp.

The client applies the same chronological floor-at-zero fold and derives automatic-star boundaries and a running balance from these facts. Automatic-star movement is signed: a tricky event can take progress from ten to nine and contribute `-1`, while a skill completion can contribute `+1` when its five faces cross a boundary. Week, month, and quarter views can therefore share one server query while using labels and buckets based on the phone's local calendar. History reflects today's active records: correcting or removing an older behaviour, or reopening/deleting a skill, can move or remove a reconstructed milestone.

## PWA cache policy

The service worker registers only in production. Cache `atlas-static-v1` contains the manifest and icon assets at install time and cache-first stores same-origin `/_next/static/` GETs on demand. Next's static filenames are content-hashed; change the cache name when changing unhashed pre-cached assets or cache policy.

The worker intentionally ignores `/`, API routes, mutation requests, and all user data. Dashboard and history responses use `no-store`. This avoids leaving persisted family data for a later user of the device and prevents stale cross-phone state, at the cost of no cold-start offline support.

The two WebP mood avatars are generated illustration derivatives stored under `private-assets/`; the original photographs are not stored in the repository. They are outside Next's `public/` directory and are read only by authenticated `GET /api/avatars/:mood` requests. Those responses use `Cache-Control: private, no-store`, and the service worker does not cache them.

## Deployment topology

`Dockerfile` produces a non-root, standalone Node runtime. `docker-compose.yml` runs one `app` service and mounts named volume `atlas_data` at `/data`; `DATABASE_PATH` is `/data/atlas.db`. Deployment-specific bind addresses remain outside this repository.

An external reverse proxy may terminate TLS and forward to the app while preserving the original host and protocol headers. Keep its hostname, address, and private network details in deployment-only configuration. The application uses `APP_ORIGIN` both for its external mutation boundary and to construct the one exact Google callback URI. Google discovery and token exchange require outbound HTTPS; there is no inbound provider webhook.

Both container and Compose health checks use `/api/health/ready`. The SQLite-aware backup script writes verified backups under `/data/backups` by default. Production operations should preserve the named volume, copy backups off-host, back up NPM's certificate/configuration data separately, protect all secret files, and keep exactly one application replica.

See the [deployment runbook](deployment.md) for the complete Google Auth Platform, WebAuthn, Cloudflare, certificate, NPM, validation, and recovery procedure.
