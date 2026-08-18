# Deployment runbook

This runbook deploys one Atlas-o-meter application instance at `https://atlas.burtonsvilla.com` behind Nginx Proxy Manager (NPM), with Google OpenID Connect for Edward, an Edward-managed local password for Lisa, WebAuthn passkeys for both people, Cloudflare DNS/certificates, and a persistent SQLite volume.

It does not automate router, firewall, operating-system, Proxmox, or NPM-host changes. Never paste real client secrets, session secrets, Cloudflare tokens, or production environment files into Git, chat, screenshots, or shared logs.

## 1. Fixed production topology

The deployment has one application container on CT230 and one named data volume:

| Component           | Exact value                                               |
| ------------------- | --------------------------------------------------------- |
| Public origin       | `https://atlas.burtonsvilla.com`                          |
| Google callback     | `https://atlas.burtonsvilla.com/api/auth/google/callback` |
| NPM upstream scheme | `http`                                                    |
| NPM upstream host   | `192.168.1.230`                                           |
| NPM upstream port   | `3000`                                                    |
| SQLite in container | `/data/atlas.db`                                          |
| Persistent volume   | `atlas_data` mounted at `/data`                           |

`docker-compose.yml` binds the application to `192.168.1.230:3000`. Keep this listener reachable only through the intended private network path; do not forward port 3000 from the public Internet. Run exactly one `app` replica because the SQLite design is intentionally single-instance.

## 2. Configure Google Auth Platform

Use the [Google Auth Platform console](https://console.cloud.google.com/auth/overview) and Google's [OpenID Connect documentation](https://developers.google.com/identity/openid-connect/openid-connect). Create or select a dedicated Google Cloud project for Atlas-o-meter. No Gmail API, Firebase, service account, or mailbox integration is required.

### Branding

Under **Google Auth Platform → Branding**:

1. Set the app name to `Atlas-o-meter`.
2. Choose a user-support email you control.
3. Add a developer-contact email you monitor.
4. If Google asks for an application home page, use `https://atlas.burtonsvilla.com`.
5. If Google asks for an authorised domain, add `burtonsvilla.com` and complete Google's domain-verification requirements.

An app logo, privacy-policy URL, and terms URL are optional for this private testing deployment unless the Console marks them as required. Do not publish the app more broadly merely to make household sign-in work.

### Audience

Under **Google Auth Platform → Audience**:

1. Select **External** because Edward's approved account is an ordinary Google account rather than a member of an Atlas Google Workspace organisation.
2. Leave the publishing status as **Testing** for this two-person household app.
3. Add Edward's approved Google account as the Atlas test user. Keep the exact address in the private deployment environment rather than this repository. Lisa does not use Google for Atlas and does not need to be added.

Atlas still enforces its own server-side allowlist. Being a Google test user alone never grants Atlas access.

### Data Access

Under **Google Auth Platform → Data Access**, configure only the identity scopes used by the application:

- `openid`
- the email identity scope, shown by Google as `email` or `.../auth/userinfo.email`

The authorization request is exactly `scope=openid email`; it does not request `profile`. Do not add any scope containing `gmail`, and do not enable the Gmail API. Atlas needs the verified email claim only—it never reads, sends, modifies, or manages email.

### OAuth client

Under **Google Auth Platform → Clients**:

1. Choose **Create client**.
2. Select application type **Web application**.
3. Name it `Atlas-o-meter production`.
4. Add this exact **Authorised JavaScript origin**:

   ```text
   https://atlas.burtonsvilla.com
   ```

5. Add this exact **Authorised redirect URI**:

   ```text
   https://atlas.burtonsvilla.com/api/auth/google/callback
   ```

6. Create the client and copy its client ID and client secret into the private production `.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

The server-side flow does not depend on Google JavaScript, but recording the production origin explicitly is safe and makes the client configuration unambiguous. The redirect URI is mandatory and must match character-for-character: HTTPS, hostname, path, no extra slash, and no query string.

For local development, add a separate Web client when practical. Its origin is `http://localhost:3000` and its redirect URI is `http://localhost:3000/api/auth/google/callback`; never put a production secret in a developer's tracked files.

## 3. Configure the private production environment

Inside the existing Atlas Compose directory on CT230, update the ignored `.env` without overwriting its current values. Lock its permissions and generate a session secret if this is a new deployment without one:

```bash
chmod 600 .env
openssl rand -base64 32
```

For a brand-new installation only, `.env.example` can be copied first; do not copy it over an existing production file. Do not replace a working `SESSION_SECRET` during this authentication migration: rotating it signs out existing sessions. Put the generated value into `SESSION_SECRET` only for a new deployment. Use this production shape, replacing every angle-bracket placeholder privately:

```dotenv
DATABASE_PATH=./data/atlas.db
SESSION_SECRET=<at-least-32-random-characters>

APP_ORIGIN=https://atlas.burtonsvilla.com
WEBAUTHN_ORIGIN=https://atlas.burtonsvilla.com
WEBAUTHN_RP_ID=atlas.burtonsvilla.com

ATLAS_EDWARD_EMAIL=<Edward-approved-Google-email>
GOOGLE_CLIENT_ID=<Google-Web-application-client-ID>
GOOGLE_CLIENT_SECRET=<Google-Web-application-client-secret>
```

The real allowed Edward email is the fixed mapping in the product specification; keep it out of committed `.env` examples. The Compose service overrides `DATABASE_PATH` to `/data/atlas.db`. All three Google-related values are server-only—do not prefix them with `NEXT_PUBLIC_`. Lisa has no email environment setting or default password. After deployment, authenticated Edward configures her Atlas-specific password in Settings; never put that password or its hash in `.env`.

Remove these obsolete settings from the production `.env`; the application no longer uses them:

```text
SMS_PROVIDER
DEV_SMS_CODE
TWILIO_VERIFY_SERVICE_SID
TWILIO_API_KEY_SID
TWILIO_API_KEY_SECRET
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
ATLAS_EDWARD_PHONE_E164
ATLAS_LISA_PHONE_E164
```

Validate interpolation without printing expanded secrets:

```bash
docker compose config --quiet
```

Do not run a plain `docker compose config` in a recorded/shared terminal because its expanded output contains secrets.

### Origin and cookie invariants

- `APP_ORIGIN` is the exact public HTTPS origin with no path or trailing slash. It constructs the fixed Google callback and same-origin security boundary.
- `WEBAUTHN_ORIGIN` is the same exact public origin.
- `WEBAUTHN_RP_ID` is only `atlas.burtonsvilla.com`, with no scheme, port, path, or slash.
- The 30-day Atlas session remains HTTP-only, Secure, SameSite Strict, and scoped to `/`, whether it follows Edward's Google login, Lisa's password login, or either person's passkey login.
- A separate ten-minute `atlas_google_login` cookie contains only an opaque challenge ID. It is HTTP-only, Secure, SameSite Lax, and scoped exactly to `/api/auth/google/callback` because Google's callback is a top-level cross-site navigation. Callback redirects are `no-store` and use `Referrer-Policy: no-referrer`.
- The callback then uses `/auth/google/complete` as a same-origin bridge before opening `/?passkey=offer`; do not add either path to Google Console. Only `/api/auth/google/callback` is an authorised Google redirect URI.

## 4. Rebuild Atlas safely on CT230

First place the reviewed application files in the existing Atlas-o-meter Compose directory using the deployment method already used for CT230. The absolute directory is installation-specific, so replace the first placeholder below with that existing directory; do not create a second deployment or a new volume by guessing a path.

Run these commands **inside CT230**:

```bash
cd <existing-Atlas-o-meter-Compose-directory>
docker compose ps
docker compose exec app node scripts/backup-db.mjs
mkdir -p ./atlas-backups
docker compose cp app:/data/backups/. ./atlas-backups/
docker image tag atlas-o-meter:local atlas-o-meter:pre-skills
docker compose config --quiet
docker compose build --pull app
docker compose up -d --no-deps app
docker compose ps
docker volume inspect atlas-o-meter_atlas_data
curl --fail http://192.168.1.230:3000/api/health/live
curl --fail http://192.168.1.230:3000/api/health/ready
curl --fail https://atlas.burtonsvilla.com/api/health/ready
```

The backup command uses SQLite's online backup API and writes `/data/backups/atlas-<timestamp>.db` inside `atlas_data`; the next two commands copy the backup directory outside the volume and retain the previous image under a rollback tag. Move the copied backup to separate protected storage after validation. `docker compose build` must finish before the running container is replaced. `up -d --no-deps app` recreates only the app container and reattaches the existing named volume.

At first database open, additive transactional migration 5 creates empty `skills` and `skill_create_requests` tables plus their indexes. It does not rewrite existing behaviours, tags, adjustment history, Google state, passwords, or passkeys. This application release does intentionally apply the new tricky-moment rule to all current active behaviour records: existing tricky moments are folded chronologically as one-point deductions, stopping at zero. On a database that already contains tricky history, effective progress and automatic-star balance may therefore change immediately after upgrade. Review the pre-upgrade balance and retain the online backup before continuing.

Never run `docker compose down -v`. The `-v` flag deletes `atlas_data`. Routine deployment also does not require `docker compose down`, database recreation, manual SQLite edits, or multiple replicas.

If the new container fails before migration or you choose to restore the old image, keep the volume attached and run:

```bash
docker image tag atlas-o-meter:pre-skills atlas-o-meter:local
docker compose up -d --no-build --force-recreate --no-deps app
docker compose ps
```

Migration 5 is additive, but an image rollback does not remove it; the older application safely ignores the extra skill tables and returns to its previous derived-progress rule. Skill changes made while the new release was running remain in SQLite and reappear on a later upgrade. Restore the copied SQLite backup only if a separate data problem is confirmed, using the documented restore drill rather than deleting or recreating `atlas_data`.

## 5. Configure Nginx Proxy Manager and TLS

Create or update one NPM Proxy Host:

| NPM field             | Value                    |
| --------------------- | ------------------------ |
| Domain Names          | `atlas.burtonsvilla.com` |
| Scheme                | `http`                   |
| Forward Hostname/IP   | `192.168.1.230`          |
| Forward Port          | `3000`                   |
| Cache Assets          | Off                      |
| Block Common Exploits | On                       |
| Websockets Support    | Off                      |
| Access List           | Publicly Accessible      |

“Publicly Accessible” here means NPM passes requests to Atlas; the application performs Google, password, or passkey authentication as appropriate for the selected person. Do not add an NPM basic-auth layer because it can interfere with the OAuth redirect experience. Leave **Advanced** blank unless the existing installation has a reviewed requirement. NPM must preserve the original `Host` and `X-Forwarded-Proto`; its standard proxy configuration does this.

On the SSL tab:

- select the valid `*.burtonsvilla.com` certificate;
- enable **Force SSL**;
- enable **HTTP/2 Support**;
- enable HSTS only after HTTPS and the Google callback work;
- do not enable HSTS for all subdomains unless every affected subdomain is permanently HTTPS.

Keep public ports 80/443 at NPM. Do not expose Atlas port 3000 or NPM's administration port 81 to the Internet.

### Wildcard certificate and Cloudflare token

Reuse the existing valid wildcard certificate when possible. If NPM must issue or renew it, use a dedicated Cloudflare API token—not the Global API Key—with:

- permission **Zone → DNS → Edit**;
- resource **Include → Specific zone → `burtonsvilla.com`**.

Enter it only in NPM's Cloudflare DNS credential field in NPM's required form:

```ini
dns_cloudflare_api_token=<dedicated-token>
```

Never add this token to Atlas's `.env`. NPM retains it for DNS-01 renewal, so protect NPM's `/data` and `/etc/letsencrypt` volumes and backups. Cloudflare documents scoped tokens in [Create API token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/); Let's Encrypt explains wildcard DNS-01 validation in [Challenge Types](https://letsencrypt.org/docs/challenge-types/).

## 6. DNS and optional Cloudflare HTTP proxy

Create or retain an `A` record named `atlas` for the public origin address. Add `AAAA` only when inbound IPv6 is configured and tested. A wildcard certificate does not require a wildcard DNS record.

The `atlas` record may be DNS-only or Cloudflare-proxied. If it is proxied:

1. Set SSL/TLS mode to **Full (strict)** after the valid NPM certificate is installed; never use Flexible.
2. Add a Cache Rule for the exact hostname `atlas.burtonsvilla.com` with cache eligibility set to **Bypass cache**.
3. Leave NPM's **Cache Assets** off.
4. Do not trust `CF-Connecting-IP` in a custom Nginx snippet unless trusted proxy ranges are explicitly constrained. Atlas authentication does not depend on source IP.

The certificate DNS-01 token manages temporary TXT records only. A changing public address needs a separate least-privilege dynamic-DNS updater; do not broaden or reuse the certificate token for that purpose.

## 7. Production acceptance

### Transport and private boundary

From a trusted client after DNS is live:

```bash
curl --head http://atlas.burtonsvilla.com
curl --fail https://atlas.burtonsvilla.com/api/health/ready
curl --silent --output /dev/null --write-out '%{http_code}\n' \
  https://atlas.burtonsvilla.com/api/auth/passkeys
curl --silent --output /dev/null --write-out '%{http_code}\n' \
  https://atlas.burtonsvilla.com/api/avatars/happy
```

Confirm HTTP redirects to HTTPS, readiness succeeds, and both unauthenticated requests return `401`. Authenticated dashboard, history, HTML, and portrait responses must not be cached by NPM or Cloudflare. From outside the private network, ports 3000 and 81 must not connect.

### Google, password, and passkey acceptance

Test each identity on its target Android phone:

1. Choose Edward, select **Continue with Google**, and authenticate with Edward's configured account. Confirm Atlas opens as Edward and offers passkey enrolment.
2. Try an unrelated Google account and confirm it is rejected. Cancel Google's account/consent screen and confirm Atlas offers a safe retry without exposing callback details. Inspect the consent page: only `openid email` identity access is present, with no Gmail mailbox permission.
3. In Edward's Settings, confirm Lisa's password initially reports **Not configured** without exposing credential material. Set a 12–128-character Atlas password containing at least one non-whitespace character. Confirm spaces are preserved and there are no other composition rules. Do not use Lisa's Gmail password.
4. Choose Lisa and confirm only her password form is available, not Google. Verify a wrong password fails generically, the exact configured password signs her in, and she is offered passkey enrolment. Confirm ten failed attempts within 15 minutes trigger the persistent limit in a disposable acceptance database rather than locking the household production credential during routine checks.
5. Enrol one passkey per identity, sign out, and confirm phone unlock creates the matching session without invoking Google or the password.
6. Cancel phone unlock and confirm **Sign in with Google instead** is Edward's fallback while the password form is Lisa's fallback.
7. Replace Lisa's password from Edward's Settings. Confirm the old password stops working and the new password works. Confirm the current limitation that her already-issued sessions and passkeys remain valid after replacement.
8. Install the PWA, close/reopen it, and repeat phone unlock from the installed experience.
9. Confirm an action on one phone appears on the other after focus, refresh, or within the normal 12-second poll.

Enroll passkeys only while signed in as the matching person. Android may satisfy required user verification with a fingerprint, face, screen lock, or password-manager passkey. That private material never reaches Atlas; only the public credential and signed WebAuthn responses do.

## 8. Backups and recovery

Create further online backups without stopping SQLite:

```bash
docker compose exec app node scripts/backup-db.mjs
```

Copy `/data/backups/atlas-<timestamp>.db` to separate protected storage and periodically test restoration in a disposable instance. The database contains behaviour history, star adjustments, tags, passkey public credentials, Lisa's 16-byte password salt and 64-byte scrypt hash, transient login rows, and persisted rate-limit state. It does not contain either person's plaintext password, Google tokens, the Google client secret, Edward's approved email, the Cloudflare token, or biometric data.

Back up NPM data and Let's Encrypt volumes separately. Preserve the private production `.env` through an appropriate secrets backup; never commit it. Rotating `SESSION_SECRET` signs out existing sessions but does not delete passkeys. If restored passkeys are unavailable, Edward can use his configured Google account; Lisa can use the restored password credential or ask Edward to replace it, then enrol another passkey. Replacing Lisa's password does not revoke an existing session or passkey.

## Troubleshooting

### Google reports `redirect_uri_mismatch`

- In the Web OAuth client, compare the URI character-for-character with `https://atlas.burtonsvilla.com/api/auth/google/callback`.
- Confirm the client type is **Web application** and the `.env` client ID/secret came from that same client.
- Confirm `APP_ORIGIN=https://atlas.burtonsvilla.com` with no trailing slash, then recreate only the app container with `docker compose up -d --no-deps app`.
- Do not register `/auth/google/complete` or `/?passkey=offer` as Google redirect URIs.

### Google says access is blocked or the app is unavailable

- Confirm Audience is **External**, publishing status is **Testing**, and Edward's approved account is listed as the test user.
- Confirm the OAuth client and consent configuration belong to the same Cloud project.
- Confirm CT230 can make outbound HTTPS requests to Google's discovery, authorization, JWKS, and token endpoints.
- Do not solve an audience or credential problem by adding Gmail scopes.

### Atlas rejects the account

- Confirm Edward was selected; Lisa intentionally has no Google path.
- Check the exact `ATLAS_EDWARD_EMAIL` value in the private environment for whitespace or transposition; never paste it into shared logs.
- A Google account other than Edward's one configured address is intentionally rejected even when Google authenticated it successfully.

### Lisa's password sign-in fails

- Sign in as Edward and check Lisa's password status in Settings. There is no default credential; configure one if the status is **Not configured**.
- Re-enter the exact password, including leading, trailing, or repeated whitespace. Atlas preserves whitespace rather than trimming or normalising it.
- After ten failures in 15 minutes, wait for the window to end. A successful verification clears the active password-attempt bucket.
- If Edward replaces the password, only the previous password stops working. Existing Lisa sessions and passkeys are deliberately not revoked by that operation.

### Callback loops or the new session is missing

- Confirm the public browser URL is exactly HTTPS and NPM forwards `Host: atlas.burtonsvilla.com` plus `X-Forwarded-Proto: https`.
- Confirm browser cookies are enabled. The transient callback cookie is SameSite Lax; the Atlas session remains SameSite Strict and becomes available after the same-origin `/auth/google/complete` bridge.
- Start the ceremony again. State/nonce rows are deliberately single-use and cannot be replayed.

### NPM returns 502

- From NPM's private network, confirm `http://192.168.1.230:3000/api/health/ready` succeeds.
- Confirm the Proxy Host uses scheme `http`, host `192.168.1.230`, and port `3000`.
- Check the app health with `docker compose ps`; do not expose port 3000 publicly as a workaround.

### Phone unlock fails

- Confirm the browser is at exactly `https://atlas.burtonsvilla.com` and both WebAuthn environment values match it.
- Confirm the phone has a screen lock or passkey-capable authenticator.
- Edward can use **Sign in with Google instead**; Lisa can use her Atlas password. Then enrol another passkey from Settings if necessary.
- If the hostname or RP ID changed, old credentials cannot be reused under the new relying party.

### Wildcard issuance fails

- Confirm the Cloudflare credential is an API token rather than the Global API Key.
- Confirm Zone DNS Edit is scoped to `burtonsvilla.com` and the NPM credential uses `dns_cloudflare_api_token=`.
- Check authoritative `_acme-challenge` TXT propagation before retrying. Avoid repeated blind issuance attempts.
