# Licensing

Every SkyGlass mirror needs a license. One license runs one mirror at a time.
Customers get a license in two ways:

| Purchase | How the key reaches the mirror |
|----------|--------------------------------|
| **Software License** (DIY hardware) | The key is emailed after checkout. The customer enters it in the phone app during setup. |
| **Hardware Kit / Complete Kit** (pre-flashed) | The key is written to the SD card at fulfilment. The mirror activates it on first boot and the customer never has to type it. |

The license API runs on the marketing site's Vercel functions (`packages/website/api/license/*`)
with Neon Postgres. There is no separate license server.

## Policy

- **Binding:** an activation binds the license to the device fingerprint: the Raspberry Pi serial
  number, or on other hardware a hash of `/etc/machine-id` and the primary MAC. The Pi serial
  survives re-flashing, so reinstalling never uses up a license.
- **Offline grace:** every successful activation or refresh returns a signed token that is valid
  for **30 days**. The mirror refreshes daily. If it can't reach the server, it keeps working until
  the token expires, then shows "Reconnect to verify". A network error never downgrades a
  valid token.
- **Revocation** (refund, chargeback; see "Refunds and disputes") takes effect at the mirror's next refresh, or at the latest
  when its token expires.
- **Transfers:** the customer can release a license from its current mirror at
  `https://skyglass.dev/license` (sign-in link sent by email). The limit is **3 releases in any
  365 days**; past that, support resets it with the admin API.
- **Enforcement level:** the signed token stops fake license servers and casual config edits.
  It does not stop someone who modifies the code on their own Pi, and it doesn't try to.

## License keys

- Format: `XXXX-XXXX-XXXX-XXXX` from the alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`
  (no `0 O 1 I`), generated with `crypto.randomInt` (80 bits).
- Input normalization (mirror, app and server): strip whitespace and dashes, uppercase, re-insert
  a dash every 4 characters, then validate against `^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$`.
- The server stores only `sha256(key)` and the last 4 characters. A plaintext key exists only in
  the customer's email, on the mirror, and on the SD card it was provisioned to.

## Activation token

`base64url(payloadJson) + "." + base64url(ed25519Signature(payloadJsonBytes))`

```json
{ "v": 1, "lid": "<license uuid>", "fp": "<device fingerprint>", "iat": 1761000000, "exp": 1763592000 }
```

`iat` and `exp` are Unix seconds, with `exp = iat + 30 days`. The signing key is
`LICENSE_SIGNING_KEY` on Vercel (an Ed25519 private key in PKCS8 PEM, base64-encoded onto one line).
The mirror verifies with the public key embedded in
`packages/backend/src/license/public-key.ts`. `SKYGLASS_LICENSE_PUBLIC_KEY` overrides it for local
testing against `vercel dev`. Generate a keypair with `node scripts/license-keygen.mjs`.

A token is accepted when the signature verifies, `fp` equals this device's fingerprint, and
`now < exp`.

## Cloud API (`https://skyglass.dev/api/license/:action`, one Vercel function)

All bodies are JSON. Errors are `{ "status": "<code>", "message": "<human text>" }`.

| Action | Body | Success | Failure statuses |
|--------|------|---------|------------------|
| `POST activate` | `{ licenseKey, deviceFingerprint, fingerprintType: "pi_serial"\|"machine_id", mirrorId?, appVersion? }` | `200 { status: "active", token, licenseId, keyLast4, activatedAt }`. Binds a `pending` license, or re-issues a token if already bound to the same fingerprint | `404 not_found`, `409 bound_to_another_device`, `403 revoked` |
| `POST refresh` | `{ licenseKey, deviceFingerprint, appVersion? }` | `200 { status: "active", token, ... }` only if the license is bound to this fingerprint. **Never binds.** Updates `last_seen_at` | `404 not_found`, `409 released` (no longer bound to this device), `403 revoked` |
| `POST manage-request` | `{ email }` | Always `200 { ok: true }`, and always after at least 1.5 s, so neither the answer nor its timing reveals whether the address has licenses. If licenses exist for that email, sends a sign-in link `https://skyglass.dev/license?token=…` valid for 30 minutes (HMAC with `LICENSE_MANAGE_SECRET`) | - |
| `POST manage-list` | `{ token }` | `200 { email, licenses: [{ id, keyLast4, productId, status, mirrorId, activatedAt, lastSeenAt }], releasesRemaining }` | `401 invalid_token` |
| `POST manage-release` | `{ token, licenseId }` | `200 { ok: true }`. Unbinds (status → `pending`) and records a release | `401`, `404`, `429 transfer_limit` |
| `POST manage-reissue` | `{ token, licenseId }` | `200 { ok: true }`. Only for `pending` licenses: new key, old key dead, new key emailed | `401`, `404`, `409 bound` |

Rate limits are per IP: activate/refresh 30 per hour, manage-request 5 per hour (plus 5 sign-in
emails per address per hour), create-payment-intent 20 per hour, failed admin sign-ins 10 per
hour. They're best-effort, kept in Postgres.

`activate` and `refresh` guard every write with the key hash they looked the license up by, so a
key reissued (or a license released or revoked) between the lookup and the write can't bind or
refresh with the old key.

Admin API: `GET|POST /api/admin/licenses` with `Authorization: Bearer $ADMIN_PASSWORD`, shared
with `api/admin/orders.ts` through `api/_lib/admin.ts`: `503` when `ADMIN_PASSWORD` is unset,
constant-time comparison, and after 10 failed attempts from one IP in an hour every request from
it gets `429` until the hour is over.
- `GET ?email=|orderId=|licenseId=`: search.
- `POST { action: "provision", licenseId }`: assigns a key to an unkeyed kit license and
  returns the plaintext once. `409 already_keyed` if it already has one.
- `POST { action: "provision", licenseId, rekey: true }`: for a license that already has a key
  but is still `pending` (the provision response was lost, or the card was never written):
  replaces the key and returns the new plaintext once. The old key stops working. `409 bound`
  if the license is active on a mirror (reset it first).
- `POST { action: "revoke" | "reset", licenseId }`.
- A malformed JSON body is `400`, never `500` (here and in the license API).

## Database (`packages/website/db/schema.sql`)

- `licenses`: `id uuid pk`, `key_hash text unique null`, `key_last4 text null`, `email`,
  `order_id text`, `order_seq int` (unique `(order_id, order_seq)` so Stripe webhook retries are
  idempotent), `product_id`, `status pending|active|revoked`, `device_fingerprint`,
  `fingerprint_type`, `mirror_id`, `activated_at`, `last_seen_at`, `created_at`, `emailed_at`
  (the confirmation or a reissue email carrying this license was sent), `email_claimed_at`
  (short lease held by the webhook delivery that is sending the confirmation).
- `license_releases`: `license_id`, `device_fingerprint`, `released_at`, `actor` (`customer` or
  `admin`). Only customer rows count toward the limit.
- `rate_limits`: `bucket text`, `window_start`, `count`.
- `promo_redemptions`: `order_id pk`, `promotion_code_id`, `coupon_id`, `created_at`. One row per
  paid order that used a promotion code (see "Checkout").

`npm run db:migrate --workspace=packages/website` applies the schema. It is idempotent
(`CREATE … IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN IF NOT EXISTS`), so it also upgrades an
existing database.

## Purchase → license

`webhook.ts` on `payment_intent.succeeded` creates one license row per licensed unit (the quantity
of each `software-license`, `hardware-kit` and `complete-kit` line). It inserts with
`ON CONFLICT (order_id, order_seq) DO NOTHING`, so retries never duplicate rows.
- `software-license` rows get a key immediately, and the key goes in the confirmation email.
- Kit rows are created **unkeyed**. The email says the license comes pre-installed.
- After inserting, it checks the PaymentIntent's latest charge: a refund or dispute that Stripe
  delivered *before* this event succeeded is applied now (rules under "Refunds and disputes").
- Confirmation email: every delivery emails the order's rows that have no `emailed_at` and aren't
  revoked, then sets `emailed_at`. The rows are claimed first (`email_claimed_at`, a 2-minute
  lease), so concurrent deliveries never both send. A software key whose plaintext was lost (a
  previous delivery inserted it but the email failed) is rotated before sending, since only its
  hash is stored. If the send fails, the claim is released and the webhook returns `500`, so
  Stripe retries (for up to 3 days). `manage-reissue` also sets `emailed_at`, so a late retry
  never rotates a key the customer just received.
- `payment_intent.payment_failed` is only logged. Stripe Elements shows the decline on the
  checkout page, and emailing on every failure would let card testers send mail to anyone.
- The signature is verified over the exact request bytes, read with `req.on('data'|'end')`
  (`api/_lib/http.ts`). `@vercel/node` ignores Next.js's `config.api.bodyParser`; it buffers the
  body itself, replays it only through those events, and makes `req.body` a lazy JSON parse, so
  the handler must never touch `req.body`.

## Refunds and disputes

Stripe events: `charge.refunded`, `refund.updated` (or `charge.refund.updated`), and
`charge.dispute.created`. Subscribe the webhook endpoint to all of them.

- **Dispute:** every license on the order is revoked.
- **Refund with `revoke_licenses` metadata:** if any refund on the charge has metadata
  `revoke_licenses` = `all`, every license on the order is revoked; if it is a comma-separated
  list of license ids, exactly those are revoked (ids not on the order are ignored). The
  threshold rule below is then skipped.
- **Otherwise, a full return:** if `amount_refunded >= charge amount − shipping − tax on
  shipping` (both from the PaymentIntent metadata), every license on the order is revoked. Per the
  Terms, a kit return refunds the product price and tax but not shipping, so this counts as a full
  return even though Stripe calls it a partial refund.
- **Otherwise:** nothing is revoked and the webhook logs a warning naming the order.

Revocation only ever moves rows to `revoked`; the admin `reset` action undoes it. A later refund
event for the same charge re-applies these rules, so reset a license again if needed.

### Support runbook: refunding part of an order

To refund one unit of a multi-unit order (e.g. one of two Hardware Kits, or one of three Software
Licenses):

1. Find the license ids: `GET /api/admin/licenses?orderId=pi_…`. Pick the unit being returned
   (for kits, the one whose `keyLast4` matches the returned card; otherwise any `pending` one).
2. Refund that unit's price plus its tax in the Stripe Dashboard.
3. Revoke the license, either way:
   - in the Dashboard, open the refund and add metadata `revoke_licenses` = `<licenseId>` (several
     ids comma-separated). The `refund.updated` event revokes them; or
   - `POST /api/admin/licenses { "action": "revoke", "licenseId": "<id>" }`.
   When creating the refund through the API or Stripe CLI, the metadata can be set at creation:
   `stripe refunds create --charge ch_… --amount <cents> -d "metadata[revoke_licenses]=<licenseId>"`.
4. A whole-order return (everything but shipping) needs no metadata: it revokes every license.

## Checkout (`api/create-payment-intent.ts`)

The server computes every amount: prices from `shared/catalog.ts`, the promo discount, shipping,
and sales tax.
- **Tax:** a Stripe Tax calculation is created by `create-payment-intent` itself, from the
  catalog lines after the promo discount (split across lines in proportion to their totals),
  shipping as `shipping_cost`, and the address being charged (the shipping address for kit carts,
  the billing ZIP for license-only carts). A `taxCalculationId` sent by the client is ignored.
  The calculation id goes in the PaymentIntent metadata (`tax_calculation_id`,
  `tax_source: stripe_tax`) and the webhook records it with `createFromCalculation`. Only when
  Stripe Tax errors is `FALLBACK_TAX_RATE` used (`tax_source: fallback`, no tax transaction). An
  address Stripe Tax can't locate is a `400` for the buyer to fix. `calculate-tax` is the
  pre-discount estimate shown in the UI and uses the same helper (`api/_lib/checkout.ts`).
- **Promotion codes:** `validate-promo` (display) and `create-payment-intent` (authoritative)
  run the same checks against the server's subtotal: code active, coupon valid, `expires_at`,
  `minimum_amount` (USD only), customer-restricted codes must match the order email (checked at
  payment; `validate-promo` checks it only if given `email`), coupons with `applies_to` products
  are rejected (our products aren't Stripe products), `amount_off` coupons must be in USD, and
  `first_time_transaction` codes are **rejected** (we can't verify a first purchase the way
  Stripe does). `max_redemptions` on the code and on the coupon are checked against Stripe's
  `times_redeemed` plus our own `promo_redemptions` rows, because PaymentIntents don't redeem
  promotion codes. Two checkouts racing for the last redemption can both succeed.
  A failed promo check at payment is a `400` naming the problem.
- Totals under Stripe's $0.50 minimum are a `400`.

## Fulfilment (pre-flashed kits)

`scripts/provision-sd.sh <licenseId> [bootVolume] [--force] [--rekey]` calls `provision` and
writes the key to `skyglass-license.txt` on the card's boot partition. The default volume is
`/Volumes/bootfs` on macOS. On the Pi that partition is `/boot/firmware`. The request times out
after 30 seconds. If it timed out or the response was lost after the key was issued, the next run
gets `already_keyed`; run it again with `--rekey` (pending licenses only) to replace that key.

A kit built for a portrait mount can also carry its orientation, so the first setup screen is
the right way up: `echo portrait-cw > /Volumes/bootfs/skyglass-orientation.txt` (or
`portrait-ccw`). The app's Orientation step still asks, starting on that value.

## Mirror (`packages/backend`)

- Key sources, in order: the key saved in the DB (entered from the app), then
  `/boot/firmware/skyglass-license.txt` (pre-flashed). A key file is activated on the first boot
  that has network: it is tried every 30 seconds for the first 10 minutes after the backend
  starts (the network is often still coming up), then every 5 minutes.
- A key file pickup (activated, or a definitive rejection) is recorded as the sha256 of the key
  in `~/.skyglass/license-keyfile-used` (outside `data/`; `SKYGLASS_LICENSE_KEYFILE_MARKER`
  overrides the path). If the DB is lost later, the same key file is **not** activated again,
  so a license released on the website can't silently re-bind; the key has to be entered in the
  app. Re-flashing the card clears the marker along with everything else.
- Config: `license.enabled` (default `true`) and `license.server` (default `https://skyglass.dev`).
  `SKYGLASS_LICENSE=off` disables licensing; the `npm run dev*` scripts set it so local
  development works without a key.
- `GET /api/license/status` →
  `{ enabled, state, keyLast4?, activatedAt?, expiresAt?, lastCheckedAt?, message?, keyFilePending, supportEmail, manageUrl }`
  where `state` is one of `disabled | unlicensed | active | expired | released | revoked | bound_elsewhere`.
  `expired` means the token lapsed: offline for more than 30 days.
  `keyFilePending` is true while a pre-installed key file is waiting to be activated (state
  `unlicensed`, no key stored): the mirror retries on its own, so the phone should show a waiting
  state instead of asking for a key. `message` is then "Activating the pre-installed license…",
  or, once the first 10 minutes have passed without reaching the server, "Connect the mirror to
  the internet to activate the pre-installed license."
- `POST /api/license/key { licenseKey }` normalizes the key, activates it and broadcasts a WS
  `license` event carrying the status. `POST /api/license/refresh` forces a refresh; with no
  stored key it tries the key file immediately (the phone can poll it while `keyFilePending`).
- Every new WebSocket connection receives a `license` event with the current status, and the
  mirror UI re-reads `/api/license/status` whenever its socket (re)connects, so a state change
  during a backend restart is never missed.
- Card or DB moved to another Pi: a stored token whose `fp` is another device's is not treated as
  `expired`. The mirror reports `unlicensed` ("Checking the license for this mirror…") and calls
  `activate` with the stored key (never `refresh`): a released (`pending`) license binds here and
  becomes `active`; one still bound to the other Pi becomes `bound_elsewhere`. Network errors are
  retried like a key file.
- Setup order: WiFi → Orientation → **License** → Location → Airport → Face. `/api/setup/status` adds
  `licenseActivated` / `license_activated`, which is always true when licensing is disabled.
  `step: 'license'` comes after `wifi` and `orientation`, and `setupComplete` requires the license.
- Once setup is complete, any state other than `active` or `disabled` replaces the mirror UI with
  the license screen.

## Implementation notes

- `licenseActivated` in `/api/setup/status` means "a license has been activated on this mirror".
  It stays true if the license later becomes `expired`, `released` or `revoked`, so a configured
  mirror shows the license screen rather than going back to the setup wizard. The stored key and
  its `activated_at` are the marker: a key rejected later (`not_found`, `bound_to_another_device`,
  `revoked`) is reported to the app but never replaces a key that was activated on this mirror.
- Background checks never crash the backend: a failing DB write keeps the in-memory state, and
  tick errors are logged. Retry intervals use a monotonic clock, so a wall-clock jump (NTP, a Pi
  without an RTC) neither stalls nor rushes them; token `exp` uses wall time.
- `POST /api/license/key` errors are `{ status, message, license }`. The `status` codes and their
  HTTP statuses are:

  | Code | HTTP |
  |------|------|
  | `invalid_key` | 400 |
  | `not_found` | 404 |
  | `bound_to_another_device` | 409 |
  | `revoked` | 403 |
  | `rate_limited` | 429 |
  | `network_error` (skyglass.dev unreachable) | 503 |
  | `server_error` (bad token or unexpected reply) | 502 |
  | `disabled` | 409 |

- The mirror trusts a 4xx from the cloud only when the body carries a known status code. Any other
  4xx, every 5xx, and a 429 on `refresh` are treated as network errors, so they never downgrade a
  license.
- Cloud extras beyond the table above:
  - `400 invalid_request` for a malformed body.
  - `429 rate_limited` from `manage-request` too, which therefore isn't "always 200".
  - `409 not_provisioned` from `manage-reissue` on a kit license that hasn't been given a key yet.
  - `404 unknown_action`.
- Refunds revoke licenses by the rules in "Refunds and disputes": a refund of everything except
  shipping revokes the whole order; anything smaller revokes only what `revoke_licenses` names.
- The admin `reset` action records an `admin` release, which doesn't count toward the customer's
  release limit.
