# Product specification

## Product and audience

Atlas-o-meter is a two-person family tool for Edward and Lisa to record their son's positive and difficult behaviour moments and turn positive moments into a simple reward currency. The primary experience is a responsive Android web app at the configured HTTPS application origin, installable to each phone's home screen.

The shared server database is the source of truth. A change made on one phone is visible on the other after a mutation refresh, window focus/reconnection, manual refresh, or the 12-second visible-page poll.

## Current user experience

### Sign-in

- The sign-in screen offers only `edward` and `lisa`. Google and passkey actor input is normalised before matching; the password route accepts only the fixed `lisa` value.
- Edward authenticates initially and as a fallback with the one exact Google email address supplied through the server's private `ATLAS_EDWARD_EMAIL` environment value. Arbitrary Google users are rejected, and Google sign-in is never offered for Lisa.
- Lisa authenticates initially and as a fallback with an Atlas-specific password. There is no default password. Until one is configured, Lisa cannot sign in and the interface directs Edward to set it from Settings.
- Any authenticated Edward session can set or replace Lisa's password from Settings without a separate step-up prompt. The password is write-only: the status response exposes only whether it is configured and when it was last updated, never the password, salt, or hash. Lisa cannot set, view, or replace it herself.
- Lisa's password must contain 12–128 characters and at least one non-whitespace character. Whitespace is preserved exactly, and there are no other composition rules. It is an Atlas password chosen by Edward, not Lisa's Google or Gmail password.
- A first-time browser offers Edward **Continue with Google** or Lisa her password form after identity selection. A returning browser that remembers a passkey offers phone unlock first; its fallback is Google for Edward and Lisa's Atlas password for Lisa. When browser memory has been cleared, either person can still explicitly try phone unlock so an existing or synced passkey remains usable.
- Edward's Google authentication uses the server-side OpenID Connect authorization-code flow. Atlas requests only `openid email`, requires Google's verified email claim, and rejects an unknown or unverified account.
- Google starts and callback attempts are each limited to ten per ten minutes for Edward. Lisa password attempts are limited to ten per 15 minutes; a successful verification or an Edward-managed password replacement clears that rate-limit bucket. Transient Google state, nonce, and PKCE data are short-lived and single-use.
- Successful Google or passkey authentication creates the same signed, HTTP-only, SameSite Strict session cookie for 30 days. The cookie is Secure in production, and signing out clears it on that phone.
- Successful Lisa password authentication creates that same session. After Google or password sign-in, the authenticated person may register a passkey immediately or later from Settings. Up to ten passkeys can be stored for each identity.
- Passkey registration and authentication require user verification and the configured HTTPS origin/relying-party ID. Challenges are single-use and expire after five minutes; passkey attempts are limited to thirty per ten minutes per identity.
- Replacing Lisa's password does not revoke her existing 30-day sessions or passkeys. Sessions remain valid until their normal expiry or sign-out, and passkeys remain valid until a future management flow can remove them.
- The selected identity labels later behaviour, skill, and star-history changes. Passkey credential metadata is stored by the server, but biometric information is never sent to Atlas-o-meter.

On Android, “phone unlock” may mean a fingerprint, face check, device screen lock, or a passkey supplied by the platform/password manager. WebAuthn lets Atlas require user verification, but the site cannot force a particular biometric method. When a passkey is absent, unsupported, cancelled, or unavailable, Edward recovers with Google and Lisa uses her Atlas password.

Atlas does not receive or store Edward's Google password and does not persist Google access tokens or refresh tokens. Gmail mailbox access is never requested: there are no scopes to read, send, modify, or manage email, and the Gmail API is not part of the product. Lisa's Atlas password is never stored directly; only its per-password salted, slow scrypt hash is persisted.

### Behaviour calendar

- The default screen is the current Monday-to-Sunday week with today selected.
- Users can move one week backward or forward, jump to today, select a day, and refresh manually.
- Each entry contains a happy or tricky mood, date/time, optional tag, creator, update audit fields, and version. The interface represents these with two personalised illustrated faces; the stable stored/API values remain `happy` and `sad`.
- Either user can add, edit, or soft-delete any entry.
- Updates and deletes reject a stale version if the other phone changed the same entry first; the client then reloads shared state.
- The dashboard query is limited to 32 days, while the UI requests one week.
- In the progress sequence, a happy moment adds one face. A tricky moment removes one face available at that point, stopping at zero; a tricky moment recorded while progress is zero does not create a debt against a later happy moment.

### Happy-moment celebration

- Saving a happy behaviour briefly expands the personalised happy portrait over the interface with a soft ring and decorative sparkles. It does not block pointer input and is hidden from assistive technology because the save result is announced separately.
- If that save crosses a ten-effective-face boundary, the animation also shows a star and the status message announces the new automatic award.
- Tricky behaviours do not trigger the celebration.
- The effect lasts about 1.35 seconds. The global `prefers-reduced-motion` rule reduces animations to an effectively immediate transition for users who request less motion.

### Tags

- An entry supports **at most one optional tag**. Multiple tags per face are not implemented.
- The form suggests all existing tags in descending usage order and lets the user type to filter the browser's suggestion list.
- Typing a previously unseen value creates it when the entry is saved.
- Tag identity is Unicode-normalised, trimmed, whitespace-collapsed, and case-insensitive. For example, `Tidying   up` and `TIDYING UP` reuse one tag; the spelling/case from its first creation remains the display name.
- Tag names are at most 48 characters. There is currently no rename, archive, merge, or delete interface.

### Skills

- Skills is a primary menu section shared by Edward and Lisa. Either authenticated parent can add a specific skill Atlas is learning, such as `Tying his shoelaces`.
- A name is 2–80 characters after Unicode normalisation, trimming, and whitespace collapse. Matching is case-insensitive. Equivalent submissions from either phone converge on the existing active canonical skill instead of creating duplicates; the current cleaned spelling is its display name. A previously deleted name can be added again as a new skill.
- A new skill begins in progress. Either parent can mark it complete, and completion contributes the equivalent of five happy faces at the completion time.
- Either parent can rename or soft-delete a skill. A completed skill can also be reopened to correct a mistake. Reopening or deleting a completed skill removes that completion's five-face contribution and can therefore recalculate progress or an automatic star; the interface confirms deletion and explains this effect.
- Renames, completion changes, and deletes use an expected version. If both phones act on the same version, the stale second change is rejected and the shared dashboard is reloaded rather than silently overwriting the first.
- The skill records who created it, who last updated it, who completed it, and any soft-delete audit. A skill has one current completion state rather than repeatable completion awards.

### Stars and rewards

Automatic progress is reconstructed from current progress events in chronological order. It starts at zero and applies these rules:

```text
happy behaviour   -> effective faces + 1
tricky behaviour  -> max(0, effective faces - 1)
skill completion  -> effective faces + 5

automatic earned  = floor(effective faces / 10)
progress          = effective faces mod 10
balance           = automatic earned + sum(all star adjustment deltas)
```

Consequences of this rule:

- Every tenth effective face adds one automatic star and resets the displayed progress to zero.
- A tricky moment subtracts only when a face is available at that point. For example, tricky then happy finishes at one, while happy then tricky finishes at zero.
- Completing a skill adds five effective faces once. Reopening it removes that completion event from the reconstruction.
- Editing, moving, reclassifying, or deleting a behaviour recalculates the ordered sequence and can add or remove a previously automatic star.
- Manual additions/removals and reward spending are append-only adjustments, each between 1 and 50 stars in magnitude and each requiring a 2–80 character reason.
- A reward is a negative adjustment and cannot exceed the current available balance.
- A manual correction may reduce the balance below zero. The same can happen if a star was already spent and a later correction to the progress timeline (such as a tricky moment, reopened skill, deletion, or backdated edit) retracts an automatic star. The UI warns about this state, disables reward spending, and future automatic stars or positive corrections clear the deficit before the balance becomes positive.
- The star-history screen shows the most recent 50 manual corrections/rewards. These adjustments do not alter effective-face progress, and automatic awards are not stored as separate ledger rows.

Example: progress is nine, then Atlas completes a skill. The five-face contribution moves progress to fourteen effective faces: one automatic star with four faces toward the next. A later tricky moment moves it to thirteen. If a tricky moment occurs at zero, progress remains zero and the next happy moment moves it to one.

### History overview

- History is a primary tab and opens on the current month. Users can switch among Week, Month, and Quarter, move to adjacent periods, or return to the current period.
- A week is Monday to Sunday and is shown in daily buckets. A month uses Monday-based week buckets clipped at the first and last day of that calendar month. A calendar quarter uses three monthly buckets.
- The view shows raw happy and tricky totals, completed-skill totals, signed automatic-star movement, opening/end balances, corrections added or removed, rewards used, net star movement, a mood trend, and a numerical bucket breakdown.
- History queries use a half-open `[from, to)` range and are limited to 100 days. The response contains ordered happy/tricky/skill-completion progress facts, star-adjustment facts, and the derived effective-face and star state immediately before the requested range.
- Automatic stars are lifetime milestones rather than `floor(period happy / 10)`. Each bucket starts from its opening effective faces, applies its progress events in chronological order with the same floor at zero, and compares automatic stars before and after. A bucket opening at ten and containing a tricky moment has automatic-star movement of `-1`; one opening at five and containing a skill completion has movement of `+1`.
- This is a reconstruction from **today's active records**, not an immutable automatic-award ledger. Moving, deleting, or changing an older behaviour, or reopening or deleting a skill, can move or remove a historical milestone. Renaming a skill leaves its completion contribution unchanged. Star corrections and rewards remain dated by their ledger creation time.
- History refreshes on entry, every 12 seconds while visible, and on focus. Responses are not cached; an already-loaded view can remain visible offline and refreshes after reconnection.

### PWA and connection behaviour

- The production app provides a manifest, standard and maskable PNG icons, standalone portrait presentation, and an Android install prompt where supported.
- The service worker pre-caches only the manifest and icon assets, then cache-first stores hashed `/_next/static/` assets.
- The personalised mood illustrations are held outside the public asset tree and served only to an authenticated session by `/api/avatars/happy` and `/api/avatars/sad`, with private `no-store` responses. They are not included in the service-worker cache.
- It does **not** cache the HTML page, authentication, dashboard/API responses, or family data.
- An already-open screen retains its current in-memory data while offline, but offline reload is not supported and behaviour, skill, or star controls cannot save until connectivity returns.

## Quality attributes

- Mobile-first layout with a 320px minimum, large touch targets, semantic buttons/forms/dialogs, visible focus states, screen-reader labels, live status messages, and reduced-motion support.
- Strict TypeScript and Zod validation at every HTTP input boundary, backed by SQLite constraints.
- Authentication and mutation requests enforce same-origin checks; authentication bodies are size-limited and strictly validated. The server enforces Edward-only password administration rather than relying on a hidden control. Security headers deny framing and disable unused camera, microphone, and geolocation permissions.
- Google OAuth credentials, Edward's allowed email mapping, the session signing secret, and WebAuthn deployment values are server-side environment configuration. The production `.env` and secrets must not enter Git, and none of these values belongs in the client bundle.
- Lisa's password is hashed with scrypt using a fresh 16-byte salt, `N=32768`, `r=8`, `p=1`, and a 64-byte derived key. The application never logs or returns the submitted password or stored credential material.
- Authentication throttles, Google login transactions, Lisa's password credential and rate limit, and WebAuthn challenges persist in SQLite, so they survive ordinary requests and process activity rather than relying on browser state alone.
- Create operations use per-user request IDs for retry safety. Behaviour edits and skill renames, completion changes, and deletes use optimistic versions for conflict detection.
- Shared responses and client requests are marked no-store.
- The repository contains only two generated illustration derivatives used as mood avatars. They are stored under `private-assets`, served through an authenticated API route, and never placed in the public asset tree. The supplied source photos are absent, and no photo-upload or face-processing feature runs in the application.

## Explicit current limits

- One household, one child, two fixed names, one optional tag per behaviour, and one current completion state per skill.
- Edward's approved Google account is deployment configuration; Lisa's write-only password is the only in-app account credential that Edward can administer. There is no general sign-up, independent recovery identity, remote session revocation, or forced session rotation.
- Passkeys can be added but are not yet listed, named, or removed in the interface. Edward can recover with his configured Google account; Lisa can recover with her password or ask Edward to replace it. Replacing the password alone does not disable a lost phone's existing Lisa session or passkey.
- Lisa's current password throttle is one shared household-identity bucket. It limits online guessing, but repeated hostile attempts can temporarily prevent Lisa's password login for up to 15 minutes; deployment-aware source controls remain future work.
- Passkey behavior is controlled by the Android browser, authenticator, and password manager. A biometric prompt is common but not guaranteed; a verified device PIN/pattern or synced passkey can satisfy WebAuthn instead.
- No full offline mode, push notifications, reports, exports, photo uploads, original-photo storage, or multi-child support.
- No star-adjustment edit/delete flow; corrections preserve the ledger history.
- Automatic-star history is reconstructed and may change after past behaviour edits or skill reopening/deletion; there is no append-only automatic-award table.
- One application instance and one local SQLite volume; horizontal scaling is unsupported.
- Calendar boundaries follow each phone's browser timezone; there is no server timezone setting. Both household phones should remain set to `Europe/London` to avoid different day/week placement.
