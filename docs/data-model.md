# Data model

SQLite is the system of record. The default local file is `./data/atlas.db`; Docker uses `/data/atlas.db` in the `atlas_data` named volume. Migration 1 creates the behaviour/reward tables, migration 2 adds passkey authentication state, migration 3 adds transient Google OpenID Connect state, migration 4 adds Lisa's local password credential, and migration 5 adds shared skills. Dates are stored as ISO 8601 strings, normally in UTC; authentication expiry/rate-limit values use Unix epoch milliseconds.

There is no `users` table. The two permitted actor identifiers, `edward` and `lisa`, are enforced by application types and database checks. Edward's exact allowed Google email (`ATLAS_EDWARD_EMAIL`) and the Google/WebAuthn provider configuration are environment values, not database rows; Lisa has no Google mapping. Google passwords and tokens are not persisted. Lisa's Atlas-specific password is represented only by a salted scrypt hash in SQLite. Thirty-day signed Atlas sessions live in HTTP-only cookies rather than SQLite.

## `schema_migrations`

| Column       | Rule                   |
| ------------ | ---------------------- |
| `version`    | Integer primary key    |
| `applied_at` | Required ISO timestamp |

Each numbered migration is applied transactionally when a process first opens the database. Existing databases receive migrations 2 through 5 in sequence without recreating behaviour, star, history, passkey, or authentication data. Migration 4 does not insert a default credential; Lisa remains unable to use password login until Edward configures one. Migration 5 creates empty skill/request tables and indexes; it does not rewrite existing rows. The release also changes the derived-progress rule, however, so every existing active tricky behaviour begins subtracting chronologically on first run. Households upgrading with existing tricky history can therefore see immediate, intentional changes to effective progress and automatic-star balance.

## `tags`

| Column            | Rule                                         |
| ----------------- | -------------------------------------------- |
| `id`              | UUID text primary key                        |
| `name`            | Required display name, 1–48 characters       |
| `normalized_name` | Required and unique                          |
| `created_by`      | `edward` or `lisa`                           |
| `created_at`      | Required timestamp                           |
| `archived_at`     | Nullable; reserved for future tag management |

Normalisation applies NFKC Unicode normalisation, trims outer whitespace, collapses internal whitespace, and lowercases with the `en-GB` locale. The first creator's cleaned spelling is retained for display. Later equivalent input reuses that row across both users.

## `behaviors`

| Column                     | Rule                                                |
| -------------------------- | --------------------------------------------------- |
| `id`                       | UUID text primary key                               |
| `mood`                     | `happy` or `sad`                                    |
| `occurred_at`              | Required behaviour date/time                        |
| `tag_id`                   | Nullable foreign key to `tags.id`                   |
| `created_by`, `created_at` | Immutable creation audit                            |
| `updated_by`, `updated_at` | Latest mutation audit                               |
| `version`                  | Integer starting at 1; incremented on update/delete |
| `deleted_at`, `deleted_by` | Nullable soft-delete audit                          |
| `client_request_id`        | Client-generated UUID used for retry safety         |

`UNIQUE(created_by, client_request_id)` makes create retries idempotent per actor. Active queries exclude rows with `deleted_at`. Partial indexes support active date, mood, and tag queries.

Each behaviour has **zero or one tag**, because `tag_id` is a single nullable foreign key. A many-to-many join table does not exist; multiple tags on one face are not supported.

Updates and deletes require the caller's expected `version`. A mismatch returns a conflict rather than overwriting a newer change from the other phone.

## `skills` (migration 5)

| Column                     | Rule                                                |
| -------------------------- | --------------------------------------------------- |
| `id`                       | UUID text primary key                               |
| `name`                     | Required cleaned display name, 2–80 characters      |
| `normalized_name`          | Required normalised identity                        |
| `created_by`, `created_at` | Immutable creation audit                            |
| `completed_by`             | Nullable `edward` or `lisa`                         |
| `completed_at`             | Nullable completion timestamp                       |
| `updated_by`, `updated_at` | Latest rename/completion/deletion audit             |
| `version`                  | Integer starting at 1; incremented on update/delete |
| `deleted_by`, `deleted_at` | Nullable soft-delete audit                          |
| `client_request_id`        | Client-generated UUID used for retry safety         |

`completed_by` and `completed_at` are either both set or both null, as are `deleted_by` and `deleted_at`. Marking a skill complete sets the completion pair and creates one five-face progress event at `completed_at`; reopening clears that pair. A completed row that is soft-deleted is excluded from progress even though its audit values remain available in SQLite.

Skill identity applies the same NFKC normalisation, outer trimming, internal whitespace collapse, and `en-GB` case-folding used for tags. A partial unique index on `normalized_name` where `deleted_at IS NULL` permits only one equivalent active skill. Creating an equivalent active name converges on that canonical row across Edward and Lisa. A soft-deleted name can be added again as a new row.

`UNIQUE(created_by, client_request_id)` protects the request that originally inserted a skill. Every accepted create request is also recorded in `skill_create_requests`, including requests that converged on another parent's canonical row. Either actor can rename, complete, reopen, or soft-delete a skill. Each update/delete supplies an expected `version`; stale writes conflict instead of overwriting the other phone. Renaming changes `name` and `normalized_name` but not completion time or progress. There is no repeatable completion ledger: one active skill has one current completion state.

## `skill_create_requests` (migration 5)

| Column              | Rule                                |
| ------------------- | ----------------------------------- |
| `created_by`        | `edward` or `lisa`                  |
| `client_request_id` | Client-generated UUID               |
| `skill_id`          | Required foreign key to `skills.id` |
| `created_at`        | Required timestamp                  |

The composite primary key is `(created_by, client_request_id)`. This durable alias makes a retry return the same skill even if the original request merely converged on an existing active name and that skill is later renamed or soft-deleted. It prevents a delayed Android retry from unexpectedly creating a second skill.

## `star_adjustments`

| Column                     | Rule                                |
| -------------------------- | ----------------------------------- |
| `id`                       | UUID text primary key               |
| `delta`                    | Non-zero integer from `-50` to `50` |
| `kind`                     | `correction` or `reward`            |
| `reason`                   | Required, 2–80 characters           |
| `created_by`, `created_at` | Immutable audit                     |
| `client_request_id`        | Client-generated UUID               |

`UNIQUE(created_by, client_request_id)` prevents a retried adjustment from being applied twice. Rows are append-only in the current product. A reward must have a negative delta and the transaction rejects spending more than the current balance. Corrections can be positive or negative and may create a negative balance.

## `password_credentials` (migration 4)

| Column            | Rule                                                       |
| ----------------- | ---------------------------------------------------------- |
| `user_slug`       | Primary key fixed by a check constraint to `lisa`          |
| `password_hash`   | Required 64-byte derived-key BLOB                          |
| `salt`            | Required 16-byte random BLOB                               |
| `algorithm`       | Required value `scrypt`                                    |
| `cost_n`          | Required scrypt CPU/memory cost `32768`                    |
| `block_size`      | Required scrypt block size `8`                             |
| `parallelization` | Required scrypt parallelization value `1`                  |
| `key_length`      | Required derived-key length `64`                           |
| `set_by`          | Required actor fixed by a check constraint to `edward`     |
| `created_at`      | Required ISO timestamp, retained across later replacements |
| `updated_at`      | Required ISO timestamp for the latest set or replacement   |

There is at most one password credential, and it belongs only to Lisa. An authenticated Edward upserts it; Lisa cannot administer it. The submitted 12–128-character password is neither trimmed nor normalised, must contain at least one non-whitespace character, and is never stored, returned, or logged. A status read projects only `configured` and nullable `updatedAt`; the salt, derived hash, and algorithm parameters are write-only application data.

Replacing this row makes the previous password fail future password verification, but it does not revoke Lisa's existing signed sessions or passkeys. Those records do not reference a password version.

## `passkeys` (migration 2)

| Column            | Rule                                                 |
| ----------------- | ---------------------------------------------------- |
| `credential_id`   | WebAuthn credential ID text primary key              |
| `user_slug`       | `edward` or `lisa`                                   |
| `public_key`      | Required credential public-key bytes                 |
| `counter`         | Non-negative authenticator signature counter         |
| `transports_json` | Required JSON array of authenticator transport hints |
| `device_type`     | `singleDevice` or `multiDevice`                      |
| `backed_up`       | Boolean encoded as `0` or `1`                        |
| `created_at`      | Required ISO timestamp                               |
| `last_used_at`    | Nullable ISO timestamp, updated after authentication |

Credential IDs are globally unique and cannot be attached to both identities. The application permits at most ten credentials per identity. Registration can update the stored metadata for an already-owned credential; successful authentication updates its counter and last-used timestamp. Counter updates compare against the value used during verification so a stale concurrent assertion cannot overwrite a newer nonzero counter. An index on `(user_slug, created_at)` supports per-user enumeration. Private biometric templates are held by the device/authenticator and are never stored here.

## `webauthn_challenges` (migration 2)

| Column       | Rule                                    |
| ------------ | --------------------------------------- |
| `id`         | UUID text primary key                   |
| `user_slug`  | `edward` or `lisa`                      |
| `purpose`    | `registration` or `authentication`      |
| `challenge`  | Required WebAuthn challenge text        |
| `expires_at` | Required expiry in Unix epoch ms        |
| `created_at` | Required creation time in Unix epoch ms |

Challenges expire after five minutes. The challenge identifier is also placed in a scoped, HTTP-only, SameSite Strict cookie. Verification consumes and deletes the database row before checking the response, so a challenge is single-use even when verification fails. Creating a challenge purges expired rows; an expiry index supports that cleanup.

## `google_auth_challenges` (migration 3)

| Column          | Rule                                              |
| --------------- | ------------------------------------------------- |
| `id`            | UUID text primary key                             |
| `user_slug`     | Originally selected `edward` or `lisa`            |
| `state`         | Required unique OIDC state, 32–256 characters     |
| `nonce`         | Required unique ID-token nonce, 32–256 characters |
| `code_verifier` | Required PKCE verifier, 32–256 characters         |
| `expires_at`    | Required expiry in Unix epoch ms                  |
| `created_at`    | Required creation time in Unix epoch ms           |

Google challenges expire after ten minutes. Migration 3's historical schema can represent either fixed actor, but the current application creates and accepts new Google transactions only for Edward. The browser cookie contains only the opaque row ID; it is HTTP-only, Secure in production, SameSite Lax for Google's top-level callback, and scoped exactly to `/api/auth/google/callback`. The selected actor, unique state, unique nonce, and PKCE verifier remain server-side.

The callback transaction fetches and deletes the row inside one immediate transaction before token exchange, then rejects missing, expired, or non-matching state. This makes every transaction single-use, including failed verification attempts. Creating a new challenge purges expired rows, and an expiry index supports that cleanup. The application never stores the authorization code, Google ID token, access token, refresh token, password, or Gmail data.

## `auth_rate_limits` (migration 2)

| Column              | Rule                             |
| ------------------- | -------------------------------- |
| `bucket_key`        | Text primary key                 |
| `window_started_at` | Window start in Unix epoch ms    |
| `attempt_count`     | Required integer of at least one |
| `updated_at`        | Latest update in Unix epoch ms   |

This table implements fixed authentication windows. Current buckets enforce ten Edward Google starts per ten minutes, ten Edward Google callbacks per ten minutes, ten Lisa password attempts per 15 minutes, and thirty passkey attempts per ten minutes per identity. A successful Lisa password verification deletes her password bucket immediately; saving or replacing her credential deletes it atomically with the credential write. The Lisa bucket is shared rather than source-specific, so repeated hostile attempts can cause a temporary household lockout until the window expires or Edward replaces the password. The table stores counters and timestamps only—never email addresses, passwords, password hashes, Google credentials/tokens, session secrets, or biometric data. Historical SMS-named buckets from an older deployment are harmless inert rows and do not need a destructive cleanup migration.

## Derived star state

Effective-face progress and automatic stars are not stored in a counter table. They are reconstructed by sorting current progress events chronologically and folding them from zero:

```text
effectiveFaces = 0
for event in chronological progress events:
  active happy behaviour  -> effectiveFaces = effectiveFaces + 1
  active tricky behaviour -> effectiveFaces = max(0, effectiveFaces - 1)
  active completed skill  -> effectiveFaces = effectiveFaces + 5

automaticEarned = floor(effectiveFaces / 10)
adjustmentTotal = sum(star_adjustments.delta), or 0
balance         = automaticEarned + adjustmentTotal
progress        = effectiveFaces mod 10
target          = 10
```

The floor is applied at every tricky event, not only to the final aggregate. Therefore tricky then happy produces one effective face, while happy then tricky produces zero; a tricky moment at zero cannot penalise a future happy moment. Editing, moving, reclassifying, or deleting a behaviour, and completing, reopening, or deleting a skill, rebuilds this sequence and can add or remove an automatic star. Renaming a skill has no progress effect.

Ordering is deterministic: semantic occurrence/completion time first, then the record timestamp, then `happy`, `skill`, `tricky`, and finally row ID. The kind/ID fallback is reached only when both timestamps tie exactly; it prevents two phones from deriving different results from the same rows.

Manual corrections and rewards remain independent of effective faces. A negative correction can make `balance` negative; so can reconstructing one fewer automatic star after that star has already been spent. The negative value is retained. New automatic stars and positive corrections increase it toward zero; reward spending remains disabled and rejected until at least one star is available.

## Dashboard projection

For a requested `[from, to)` range, the dashboard returns:

- active behaviours in the range, newest first;
- every unarchived tag with active usage count;
- all active shared skills, including creation, current completion, update, and version audit fields;
- the global derived star summary, based on all time rather than the visible week;
- the 50 newest star adjustments;
- a server sync timestamp.

## History projection and derived buckets

For a validated `[from, to)` range of no more than 100 days, one read transaction returns:

- the derived effective-face and automatic-star state immediately before `from`;
- the sum of star-adjustment deltas created before `from`;
- ordered active happy/tricky behaviour and completed-skill progress facts inside the range;
- star-adjustment delta/kind/timestamp facts inside the range;
- a server sync timestamp.

The opening values are passed through the normal star calculation to produce `openingStars`. Progress facts are compact and do not expose skill names, tags, reasons, actor audit, passkey credentials, Google identity, or authentication-challenge data.

The browser constructs local calendar buckets and derives each bucket in chronological order:

```text
automatic stars in bucket =
  floor(effective faces after ordered bucket events / 10)
  - floor(effective faces before ordered bucket events / 10)

closing balance =
  floor(running effective faces / 10) + running adjustment total
```

The automatic-star value is signed: a tricky event can revoke a boundary crossed earlier, while a skill completion can cross one. Corrections are divided into positive additions and negative removals; negative `reward` adjustments are reported as rewards used. Because only current active behaviours and active completed skills participate, editing, moving, reclassifying, or soft-deleting a behaviour, and reopening or soft-deleting a skill, reconstructs the historical milestone distribution. There is intentionally no persisted automatic-star-award or skill-completion ledger.
