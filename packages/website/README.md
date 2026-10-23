# SkyGlass website

The marketing site and store at [skyglass.dev](https://skyglass.dev), plus the SkyGlass cloud
service: the license API, checkout, and the keyed proxies mirrors use for calendar sign-in,
NOTAMs and stock quotes. Deployed to Vercel.

- **Site:** Vite, React 19, TypeScript, Tailwind CSS v4 (Glass Cockpit tokens and components in
  `src/index.css`, design reference in `docs/design/`), Motion, Zustand, React Router,
  react-helmet-async
- **API:** Vercel functions in `api/` (Node.js), Neon Postgres, Stripe (Payment Element, Tax,
  promotion codes), Resend
- **Analytics:** Vercel Web Analytics (sign-in and invite tokens are stripped first, `src/App.tsx`)

## Development

Dependencies are installed from the repo root (`npm install`). Then, from the root:

```bash
npm run dev --workspace=packages/website    # site only, http://localhost:5174
```

`npm run dev` runs Vite only, so `/api/*` is not served (the waitlist pretends to succeed in
development). To run the functions too, use the Vercel CLI from this directory (linked with
`vercel link`; `vercel env pull` fetches development variables):

```bash
cd packages/website
vercel dev                                   # site + api/, http://localhost:3000
stripe listen --forward-to localhost:3000/api/webhook
```

Other scripts: `npm run build` (type-checks the site, `api/` and `shared/`, then builds),
`npm run lint`, `npm run db:migrate` (applies `db/schema.sql` to `DATABASE_URL`).

## Layout

```
api/                    Vercel functions (one per file; api/_lib/ is shared code, not deployed)
  create-payment-intent.ts, calculate-tax.ts, validate-promo.ts, webhook.ts   checkout
  waitlist.ts           pre-order waitlist (Resend audience)
  license/[action].ts   license API for mirrors and the /license page
  admin/                orders and licenses for the admin page
  oauth/, data/         cloud service for mirrors (calendar sign-in, NOTAMs, stocks)
db/schema.sql           Postgres schema (licenses, releases, rate limits, promo redemptions)
firewall/               Vercel WAF rate-limit rules (scripts/firewall-rules.mjs stages them)
shared/catalog.ts       products, prices, shipping, lead time: used by the site and the API
public/                 static files, including the Google OAuth bounce page (oauth/google.html)
src/                    the site: pages/, components/, store/ (cart, waitlist), config/
```

Feature flags (`src/config/features.ts`): `VITE_FEATURE_ECOMMERCE` turns on the cart and checkout
(otherwise every call to action is the waitlist); `VITE_FEATURE_PREORDERS` marks purchases as
pre-orders.

## API

| Endpoint                                                      | Purpose                                                   | Docs                    |
| ------------------------------------------------------------- | --------------------------------------------------------- | ----------------------- |
| `POST /api/waitlist`                                          | Add an address to the waitlist audience; sends no email   | `api/waitlist.ts`       |
| `POST /api/calculate-tax`, `/api/validate-promo`              | Tax estimate and promo check for the checkout UI          | `docs/LICENSING.md`     |
| `POST /api/create-payment-intent`                             | Prices the cart and creates the PaymentIntent             | `docs/LICENSING.md`     |
| `POST /api/webhook`                                           | Stripe events: licenses, confirmation email, refunds      | `docs/LICENSING.md`     |
| `POST /api/license/:action`                                   | Activate/refresh (mirrors), manage-\* (the /license page) | `docs/LICENSING.md`     |
| `GET\|POST /api/admin/licenses`, `GET /api/admin/orders`      | Admin page (`Authorization: Bearer $ADMIN_PASSWORD`)      | `docs/LICENSING.md`     |
| `GET /api/oauth/config`, `POST /api/oauth/google/token`       | Calendar sign-in broker for mirrors                       | `docs/CALENDAR.md`      |
| `GET /api/data/notams`, `/api/data/stocks`, `/stock-profiles` | Keyed, CDN-cached data proxies for mirrors                | `docs/CLOUD_SERVICE.md` |

None of these send CORS headers: the site calls them same-origin and mirrors call them
server to server. Rate limits (per IP in Postgres, plus Vercel WAF rules) are described in
`docs/CLOUD_SERVICE.md` and `docs/LICENSING.md`.

## Environment variables

Every variable is listed, with comments, in `.env.example`. In short:

| Area                      | Variables                                                                        | More                     |
| ------------------------- | -------------------------------------------------------------------------------- | ------------------------ |
| Store mode                | `VITE_FEATURE_ECOMMERCE`, `VITE_FEATURE_PREORDERS`                               | `src/config/features.ts` |
| Stripe                    | `STRIPE_SECRET_KEY`, `VITE_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`      | `docs/LICENSING.md`      |
| Email and waitlist        | `RESEND_API_KEY`, `RESEND_AUDIENCE_ID`                                           | `docs/LICENSING.md`      |
| Licensing and rate limits | `DATABASE_URL`, `LICENSE_SIGNING_KEY`, `LICENSE_MANAGE_SECRET`, `ADMIN_PASSWORD` | `docs/LICENSING.md`      |
| Cloud service             | `GOOGLE_*`, `MICROSOFT_*`, `FAA_NOTAM_*`, `FINNHUB_API_KEY`                      | `docs/CLOUD_SERVICE.md`  |

## License

See LICENSE at the repository root.
