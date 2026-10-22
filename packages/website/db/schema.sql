-- SkyGlass license database (Neon Postgres). See docs/LICENSING.md.
-- Idempotent: apply with `npm run db:migrate --workspace=packages/website`.
-- Statements are split on ";" at end of line by scripts/db-migrate.mjs, so
-- keep each statement's terminating semicolon at the end of a line.

CREATE TABLE IF NOT EXISTS licenses (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- sha256 hex of the normalized key; NULL for kit licenses until provisioned
  key_hash           text UNIQUE,
  key_last4          text,
  email              text NOT NULL,
  -- Stripe PaymentIntent id
  order_id           text NOT NULL,
  -- 1..N per licensed unit in the order; makes webhook retries idempotent
  order_seq          int NOT NULL,
  product_id         text NOT NULL,
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked')),
  device_fingerprint text,
  fingerprint_type   text CHECK (fingerprint_type IN ('pi_serial', 'machine_id')),
  mirror_id          text,
  app_version        text,
  activated_at       timestamptz,
  last_seen_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  -- set once the order confirmation (or a reissue email) for this row was sent
  emailed_at         timestamptz,
  -- lease held by the webhook delivery that is sending the confirmation
  email_claimed_at   timestamptz,
  UNIQUE (order_id, order_seq)
);

-- Columns added after the first release (no-ops on a fresh database).
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS emailed_at timestamptz;
ALTER TABLE licenses ADD COLUMN IF NOT EXISTS email_claimed_at timestamptz;

CREATE INDEX IF NOT EXISTS licenses_email_lower_idx ON licenses (lower(email));

CREATE TABLE IF NOT EXISTS license_releases (
  id                 bigserial PRIMARY KEY,
  license_id         uuid NOT NULL REFERENCES licenses (id) ON DELETE CASCADE,
  device_fingerprint text,
  released_at        timestamptz NOT NULL DEFAULT now(),
  -- only 'customer' rows count toward the transfer limit
  actor              text NOT NULL CHECK (actor IN ('customer', 'admin'))
);

CREATE INDEX IF NOT EXISTS license_releases_license_idx ON license_releases (license_id, released_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket       text NOT NULL,
  window_start timestamptz NOT NULL,
  count        int NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);

-- One row per paid order that used a promotion code (written by the webhook).
-- PaymentIntents don't redeem Stripe promotion codes, so checkout counts these
-- rows against max_redemptions.
CREATE TABLE IF NOT EXISTS promo_redemptions (
  order_id          text PRIMARY KEY,
  promotion_code_id text NOT NULL,
  coupon_id         text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS promo_redemptions_code_idx ON promo_redemptions (promotion_code_id);
CREATE INDEX IF NOT EXISTS promo_redemptions_coupon_idx ON promo_redemptions (coupon_id);
