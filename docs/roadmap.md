# Roadmap

The first usable release is implemented and remains runnable: a responsive shared week calendar, personalised illustrated mood faces and happy celebration, one-tag behaviour entry, floor-at-zero tricky-moment progress, a shared versioned Skills section whose completions contribute five faces, derived stars, correction/reward ledger, week/month/quarter reconstructed history, Google OpenID Connect for Edward, an Edward-managed local password for Lisa, optional WebAuthn passkeys for both people, 30-day signed sessions, SQLite persistence, PWA assets, automated domain/auth/repository tests, and a single-instance Docker deployment definition.

## Milestone 1 — Safe household launch

- Generate a strong production `SESSION_SECRET`; configure the production origin, WebAuthn relying-party ID, Google Web client credentials, and Edward's exact email mapping only in the host's ignored environment file.
- Configure the Google Auth Platform external/testing audience, Edward as its sole Atlas test user, minimum `openid email` identity scopes, authorised origin, and exact callback URI.
- Configure the private deployment's final HTTPS origin and reverse proxy. HTTPS and the final hostname must be in place before registering passkeys.
- Start exactly one Compose app service and verify both health endpoints.
- Verify only Edward can start Google sign-in and only his configured account succeeds. From Edward's authenticated Settings, set Lisa's non-default Atlas password; verify Lisa can sign in with it, is offered passkey enrolment, and cannot use Google. Register a passkey on each Android phone, confirm the platform may offer a fingerprint, face, screen lock, or password-manager passkey, and confirm Edward falls back to Google while Lisa falls back to her password.
- Exercise cross-phone behaviour and skill add/edit/complete/reopen/delete flows, reward flows, floor-at-zero tricky logic, History period navigation and signed reconstruction, the happy/star celebration, reduced-motion behavior, and PWA installation.
- Confirm unauthenticated requests cannot retrieve the mood avatars and authenticated avatar responses remain private and uncached.
- Schedule SQLite-aware backups, copy them off-host, and perform a documented restore drill.

Exit condition: Edward can authenticate with his approved Google account, Lisa can authenticate with the password Edward set, both can use registered passkeys over HTTPS with the correct identity-specific fallback, both phones share durable behaviours, skills, progress, and rewards, and a tested off-host backup can restore the service.

## Milestone 2 — Authentication operations

- Add passkey listing, friendly device names, and safe removal so the ten-key limit and lost phones can be managed without direct SQLite access.
- Design a deliberate Edward Google-account change/recovery process that cannot silently remap him and accounts for loss of both his Google and passkey access.
- Add remote session revocation/rotation and a deliberate policy for the current 30-day lifetime. In particular, Lisa password replacement currently leaves her existing sessions and passkeys valid, so a lost-device response needs explicit revocation controls.
- Extend throttling with deployment-aware abuse controls and operational monitoring for Edward's Google provider failures and Lisa password attacks; current limits deliberately do not treat proxy IP addresses as household identity.
- Add browser-level coverage around Edward's Google redirect/callback, Lisa's password login/administration, and the full WebAuthn ceremony in addition to the current session, provider-boundary, challenge, rate-limit, and credential-repository tests.
- Decide whether change history should show a device as well as an actor.

Exit condition: lost phones, stale passkeys, Edward's changed approved account, Lisa's password recovery, and active sessions can be managed safely without database surgery, and every authentication ceremony has browser integration coverage.

## Milestone 3 — Household administration

- Add safe tag rename, archive, and merge flows while preserving historical references.
- Add an explicit compensating flow for incorrect star adjustments.
- Add data export and a guided backup/restore runbook.

Exit condition: routine data maintenance needs no direct SQLite access and remains auditable.

## Milestone 4 — Resilience and richer use

- Decide whether a future server-configured household timezone should replace browser-local calendar boundaries.
- Add a browser end-to-end suite covering Edward's Google and Lisa's password fallback from passkeys, mobile navigation, History, the celebration/reduced-motion path, install metadata, accessibility, and cross-session conflicts.
- If offline entry is valuable, design an encrypted/local queue with explicit conflict and privacy behavior; do not cache API data implicitly.
- Consider tag insights, comparison/export reports, multiple children, or notifications only after observing real household use; week/month/quarter overviews already exist.

Exit condition: each adopted feature has documented privacy, conflict, migration, and test behavior.

## Scaling trigger

Remain on one SQLite-backed app instance for the intended household workload. Before adding replicas, multiple hosts, or broader household tenancy, migrate persistence to a server database and revisit sessions, authorization, realtime sync, backups, and tenant isolation as one architectural milestone.
