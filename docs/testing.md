# Testing

## Automated checks

Run the complete local gate from the repository root:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm test:watch` runs Vitest interactively. Tests use the Node environment by
default; focused component suites opt into jsdom.

### Current suites

`src/lib/domain.test.ts` covers:

- Unicode, whitespace, and case normalisation for tag and skill names, including the 2–80-character cleaned skill boundary;
- strict login, Lisa password, password-administration, behaviour, skill, dashboard-range, and star-adjustment validation, including unknown-field rejection and optimistic versions;
- ordered progress folding, including tricky-at-zero saturation, order-sensitive tricky/happy cases, five-face skill completions, automatic-star boundaries, adjustments, and progress.

`src/lib/db.test.ts` opens a fresh `:memory:` SQLite database for each test and covers:

- chronological happy/tricky/skill progress, including a tricky moment at zero, automatic-star revocation, and a completed skill's five-face contribution;
- per-actor idempotency for behaviour, skill, and adjustment retries, plus convergence on an equivalent active skill name;
- cross-user reuse and audit of normalised tags;
- cross-user skill creation/completion audit, rename, reopen, soft delete, re-adding a deleted name, and optimistic-version conflict rejection;
- happy/sad updates, soft deletes, audit fields, dashboard exclusion, and star recalculation;
- valid reward spending and atomic rejection/rollback of overspending.

`src/lib/auth.test.ts` covers signed-session round trips, token tampering and expiry, and the same-origin mutation guard.

`src/lib/auth-db.test.ts` opens fresh in-memory databases and covers:

- passkey public-key bytes, transport/device metadata, counters, creation/last-used audit fields, per-user lookup, and stale compare-and-swap counter rejection;
- rejection of a credential linked to the other identity and the ten-passkey-per-user limit;
- five-minute WebAuthn challenge expiry, one-time consumption, user/purpose scoping, missing challenges, and expired-row cleanup;
- ten-minute Google transaction persistence, actor/state/nonce/PKCE binding, expiry, mismatch rejection, expired-row cleanup, and one-time consumption;
- Lisa's 16-byte salts, 64-byte scrypt hashes and parameter metadata, Edward audit fields, credential replacement without storing plaintext, and atomic clearing of a pre-existing password lockout;
- Edward Google-start/callback, Lisa password, and per-identity passkey-attempt limits, including window reset and clearing the Lisa password bucket after a successful verification.

`src/lib/google-oidc.test.ts` mocks the `openid-client` provider boundary and covers:

- exact Google issuer and callback URL, authorization-code response type, minimum `openid email` scopes, PKCE S256, independent state/nonce, fixed redirects, and no Gmail/offline/client-secret request parameters;
- explicit ID-token signature checking and server verification inputs for stored PKCE, state, and nonce;
- verified Edward mapping, unknown and unverified account rejection, and fail-closed rejection of Lisa from the Google flow;
- fail-closed invalid-signature, wrong-audience, expired-token, and nonce-mismatch provider outcomes;
- fully injected provider results so no test contacts Google or uses production credentials.

`src/lib/password-auth.test.ts` covers the fixed scrypt parameters, independently random 16-byte salts, 64-byte derived hashes, correct and incorrect password verification, replacement behavior, and exact preservation of valid password whitespace.

The password route suites cover:

- `src/app/api/auth/password/login/route.test.ts`: Lisa-only payloads, session creation, same-origin checks, and safe failure responses that never create a session;
- `src/app/api/settings/lisa-password/route.test.ts`: the authenticated Edward-only status/replacement boundary, strict input policy, `{ configured, updatedAt }` responses, and authorization failures. The underlying authorization helper is mocked here and enforced separately by `requireEdward`.

`src/lib/migrations.test.ts` starts from a representative older database and verifies that migrations 3–5 add Google-challenge, empty Lisa-password, and empty shared-skill storage while existing behaviour, passkey, and historical rate-limit rows remain intact. It also exercises the migration-5 skill constraints and partial active-name uniqueness.

`src/lib/history.test.ts` covers:

- Monday-to-Sunday week windows, Monday-clipped monthly buckets, calendar-quarter buckets, and period navigation;
- local-midnight behavior across the Europe/London spring daylight-saving transition;
- half-open bucket boundaries; ordered happy, tricky, and skill-completion facts; floor-at-zero behavior; positive and negative automatic-star boundary movement; correction/reward classification; opening/closing balances; and empty buckets.

`src/lib/history-db.test.ts` covers opening effective-face/star reconstruction, active-row filtering, skill completions before and within the range, exact `[from, to)` progress/adjustment boundaries, and exclusion of reopened/deleted skills and soft-deleted behaviour facts.

The suite's assertion count is deliberately not a release target; add assertions for every corrected defect and changed invariant.

## Manual phone acceptance

Before a household release, use two independent browser sessions or the two target Android phones:

1. Choose Edward, use **Continue with Google**, and confirm only Edward's configured, verified Google account succeeds. Try an unrelated account and confirm Atlas rejects it without switching identity or leaking provider details. Choose Lisa and confirm no Google action is offered and a Google start request for Lisa is rejected.
2. Cancel Edward's Google consent, retry an expired callback, and exercise the start/callback limit. Confirm each failure creates no session and leaves a friendly retry path. Confirm no consent screen requests Gmail mailbox access.
3. Confirm successful Edward Google sign-in creates his expected 30-day identity session, passes through the same-origin completion screen, offers passkey enrolment, and clears on sign-out. In Edward's Settings, confirm Lisa's password initially reports only **Not configured** with no secret value.
4. As Edward, try passwords shorter than 12 characters, longer than 128, and all-whitespace; confirm each is rejected. Set a valid password containing leading/trailing whitespace and confirm whitespace is preserved rather than silently trimmed. Confirm the card shows only configured status, and inspect the status API to confirm it adds only the update time—never the password, salt, or hash. In a Lisa session or signed-out browser, confirm the setting is unavailable and its API rejects access.
5. Before configuration, confirm Lisa cannot sign in and sees the Edward-configuration guidance. After configuration, try a wrong Lisa password and confirm the failure is generic and creates no session. Exercise the ten-attempt/15-minute limit in a disposable test database. Confirm setting/replacing the password clears that lockout; also make one failed attempt followed by a successful verification and confirm success clears the bucket.
6. Sign in as Lisa with the exact configured password. Confirm the resulting session is Lisa's, passkey enrolment is offered, the session survives ordinary closes/reopens within 30 days, and sign-out clears it.
7. Replace Lisa's password as Edward. Confirm the old password no longer works and the new one does. Also confirm the explicitly documented current limit: already-issued Lisa sessions and passkeys remain valid after replacement.
8. Accept passkey enrolment on each target Android phone. Confirm Android may use a fingerprint, face, screen lock, or password-manager passkey—Atlas must require user verification but must not promise a particular biometric.
9. Sign out and use phone unlock to return without invoking the primary method. Cancel it and confirm **Sign in with Google instead** appears only for Edward while Lisa gets her password fallback. Clear browser storage and confirm **Use phone unlock instead** can still invoke an existing or synced passkey; on a browser with no registered passkey, confirm it returns safely to the identity-specific primary action. Add another passkey from Settings and confirm the displayed count changes.
10. Add happy and tricky entries on different days, with no tag, a new tag, and a differently cased existing tag. Confirm only one tag can be assigned and equivalent names are reused.
11. At zero progress, record a tricky moment and then a happy moment; confirm progress ends at one. Remove them, record happy then tricky, and confirm progress ends at zero. Build ten effective faces, add a tricky moment, and confirm the automatic star is revoked and progress becomes nine.
12. In Skills as Lisa, add `Tying his shoelaces`. Add an equivalent differently cased/spaced name as Edward and confirm both phones show one canonical active skill. Confirm the creator audit is Lisa.
13. Complete that skill as Edward and confirm it moves to completed, records Edward, and adds exactly five effective faces. Reopen it and confirm the five faces disappear. Rename it, then soft-delete it after the confirmation; if it was complete, confirm the warning and progress/star reconstruction. Add the deleted name again and confirm a new active skill is allowed.
14. Confirm every behaviour and skill change appears on the other phone after focus, refresh, or at most one 12-second polling interval.
15. Edit the same behaviour from stale state on both devices, then repeat with a skill rename/completion. Confirm each second write is rejected and refreshed instead of silently overwriting.
16. Save a happy face and confirm the short expanding portrait/sparkle celebration does not block controls or cause duplicate screen-reader output. Cross a ten-effective-face boundary and confirm the extra star plus live status message. Save a tricky face and confirm it does not celebrate. Enable Android/browser reduced motion and confirm the movement is effectively suppressed.
17. Edit, move, reclassify, or delete an older behaviour and reopen/delete a completed skill. Confirm effective progress and automatic stars consistently reconstruct.
18. Add/remove a correction, deliberately create a negative balance, and confirm the warning and disabled reward action. Then clear the deficit; confirm corrections never change effective-face progress.
19. Spend an available reward and attempt to overspend; confirm only the valid ledger row appears.
20. Open History and verify Week has daily Monday-to-Sunday buckets, Month has clipped Monday-based weeks, and Quarter has three months. Navigate previous/next/current periods and compare raw happy/tricky totals, skill completions, corrections, and balances with known records. Start with five earlier effective faces, complete a skill inside the period, and confirm `+1` automatic-star movement.
21. Start a period with ten effective faces, record a tricky moment, and confirm History reports `-1` automatic-star movement rather than formatting it as earned. Edit, move, or delete an older behaviour and reopen/delete a skill, then confirm History reconstructs the affected milestone and explains that behaviour. Check an empty period and a period with a negative balance.
22. Go offline with the app already open. Confirm current in-memory data remains visible, behaviour/skill/star controls do not save, History reports that it will refresh, and reconnecting reloads. Confirm a cold offline reload is not promised.
23. Check keyboard focus, screen-reader names, confirmation/modals, touch target sizes, and layouts at 320px and typical Android widths. Confirm all five main navigation destinations fit, Skills controls expose names and state without relying on colour, login/Settings password fields have appropriate labels and autocomplete hints, both illustrated faces remain cleanly cropped, charts have equivalent numerical text, and decorative portraits/celebration are not announced twice.

## Deployment smoke test

After configuring `.env`, the reverse proxy, and DNS:

```bash
docker compose build --pull app
docker compose up -d --no-deps app
docker compose ps
curl --fail http://127.0.0.1:3000/api/health/live
curl --fail http://<configured-application-host>/api/health/ready
docker compose exec app node scripts/backup-db.mjs
```

Also verify that the app listener is reachable only through the intended private deployment path, HTTPS is valid, unauthenticated API requests cannot read family data or mood avatars, `atlas_data` survives a container recreation, and a copied backup can restore into a disposable instance.

Before the first real sign-in, verify the Google client is a Web application, Edward's exact email value and the client credentials are present only in the ignored host environment, the OAuth client has the exact callback, and its testing audience permits Edward. Confirm only `openid email` is requested and Lisa has no Google mapping or Google test-user requirement. Verify `WEBAUTHN_ORIGIN` exactly matches the HTTPS origin and `WEBAUTHN_RP_ID` matches its hostname. An unauthenticated GET to `/api/avatars/happy` or `/api/avatars/sad` must return `401`; an authenticated request must return WebP with `Cache-Control: private, no-store`.

In production Chrome, verify the manifest uses 192px, 512px, and maskable PNG icons and installation opens in standalone mode. Inspect service-worker storage to confirm that only the manifest/icons and `/_next/static/` assets are cached; `/`, authentication, `/api/dashboard`, `/api/history`, `/api/avatars/*`, and family data must not be present.

## Known gaps

- There is no automated browser/end-to-end or visual-regression suite yet.
- Route-level cookies, authenticated avatar delivery, security headers, the full browser Google redirect, Lisa password/Settings experience, and complete WebAuthn registration/authentication ceremonies are not directly end-to-end tested; session, provider-boundary, password/credential storage, challenge, migration, rate-limit, and origin primitives are covered below the browser level.
- Google tests use an injected provider boundary. Real discovery, consent, account selection, credential configuration, and provider availability require deployment verification.
- History date/derivation and repository projections are unit-tested, but the responsive chart, signed automatic-star presentation, period controls, polling, offline state, and accessibility require browser testing.
- The happy celebration has no component or visual-regression test; its timing, star variant, assistive-technology behavior, and reduced-motion treatment require manual verification.
- PWA installation, offline behavior, Nginx Proxy Manager access, backup restoration, and real two-phone behaviour/skill polling require manual verification.
- Building the production Docker image remains a release gate in addition to the application checks above.
