# SkyGlass Website

Marketing website and e-commerce platform for SkyGlass - a smart mirror for pilots.

## Tech Stack

- **Framework**: React 18 + TypeScript
- **Styling**: Tailwind CSS
- **Animation**: Motion (Framer Motion)
- **State**: Zustand
- **Payments**: Stripe (Elements, Tax, Coupons)
- **Email**: Resend
- **Hosting**: Vercel
- **Analytics**: Vercel Analytics

## Getting Started

### Prerequisites

- Node.js 20+
- Stripe account (test mode for development)
- Resend account (for emails)

### Installation

```bash
cd packages/website
npm install
```

### Environment Setup

Copy the example environment file and configure:

```bash
cp .env.example .env
```

Required variables:

| Variable                      | Description                                |
| ----------------------------- | ------------------------------------------ |
| `VITE_FEATURE_ECOMMERCE`      | Enable e-commerce mode (`true`/`false`)    |
| `STRIPE_SECRET_KEY`           | Stripe secret key (starts with `sk_`)      |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Stripe publishable key (starts with `pk_`) |
| `STRIPE_WEBHOOK_SECRET`       | Stripe webhook signing secret              |
| `RESEND_API_KEY`              | Resend API key                             |
| `RESEND_AUDIENCE_ID`          | Resend audience for waitlist               |
| `ADMIN_PASSWORD`              | Password for admin dashboard               |

### Development

```bash
npm run dev
```

Open http://localhost:5174 (port set in `vite.config.ts`; 5173 belongs to the mirror UI)

### Local Stripe Webhook Testing

```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Forward webhooks to local server
stripe listen --forward-to localhost:5173/api/webhook
```

## Project Structure

```
packages/website/
├── api/                        # Vercel serverless functions
│   ├── create-payment-intent.ts  # Stripe payment creation
│   ├── calculate-tax.ts          # Stripe Tax calculation
│   ├── validate-promo.ts         # Promo code validation
│   ├── webhook.ts                # Stripe webhook handler
│   ├── waitlist.ts               # Waitlist signup
│   └── admin/
│       └── orders.ts             # Admin orders API
├── src/
│   ├── components/             # React components
│   │   ├── Navigation.tsx
│   │   ├── Hero.tsx
│   │   ├── Features.tsx
│   │   ├── HowItWorks.tsx
│   │   ├── InteractiveDemo.tsx
│   │   ├── Pricing.tsx
│   │   ├── FAQ.tsx
│   │   ├── Footer.tsx
│   │   ├── CartDrawer.tsx
│   │   ├── WaitlistModal.tsx
│   │   └── SEO.tsx
│   ├── pages/                  # Page components
│   │   ├── Home.tsx
│   │   ├── Checkout.tsx
│   │   ├── CheckoutSuccess.tsx
│   │   ├── Admin.tsx
│   │   ├── Privacy.tsx
│   │   ├── Terms.tsx
│   │   └── NotFound.tsx
│   ├── config/
│   │   ├── features.ts         # Feature flags
│   │   └── stripe.ts           # Stripe appearance config
│   ├── store/
│   │   └── cart.ts             # Zustand cart store
│   ├── App.tsx
│   └── main.tsx
└── .env.example                # Environment template
```

## Features

### Marketing Website

- Hero with product visualization
- Feature showcase with aviation visual language
- Interactive demo (METAR display simulation)
- Hardware kit pricing cards
- FAQ section
- SEO optimized with meta tags and structured data

### E-commerce (Feature Flagged)

Enable with `VITE_FEATURE_ECOMMERCE=true`

#### Cart System

- Zustand store with localStorage persistence
- CartDrawer component with quantity controls
- Products: Software License ($99), Hardware Kit ($349), Complete Kit ($549). Ids, names,
  prices and shipping rules live in `shared/catalog.ts`, used by both `src/` and `api/`

#### Checkout Flow

1. **Information** - Email collection (license-only carts also collect a US billing ZIP for sales tax)
2. **Shipping** - Address entry with validation (only when the cart contains a kit)
3. **Payment** - Stripe Elements with custom styling

#### Stripe Integration

| Feature   | Implementation                                                                    |
| --------- | --------------------------------------------------------------------------------- |
| Payment   | PaymentIntent with Elements                                                       |
| Tax       | Stripe Tax (location-based) with fallback                                         |
| Discounts | Promotion Codes via Coupons API                                                   |
| Webhooks  | payment_intent.succeeded, charge.refunded, refund.updated, charge.dispute.created |

#### Promo Codes

- Validates against Stripe Promotion Codes
- Supports percent off and fixed amount discounts
- Checks usage limits, expiration, minimum amounts
- Server-side validation prevents manipulation

#### Order Emails

- Confirmation email on successful payment
- License key (software) or pre-installed note (kits) in the confirmation; declines are shown inline by Stripe Elements, no email
- Styled to match brand (dark theme, amber accents)

### Admin Dashboard (`/admin`)

Password-protected dashboard showing:

- Order statistics (total orders, revenue, pending)
- Filterable orders table
- Order detail modal with Stripe link
- Customer email action

### Waitlist Mode

When `VITE_FEATURE_ECOMMERCE=false`:

- "Join Waitlist" instead of "Add to Cart"
- Waitlist modal collects email + home airport
- Adds contact to Resend audience
- Sends welcome email

## API Endpoints

| Endpoint                     | Method | Description                  |
| ---------------------------- | ------ | ---------------------------- |
| `/api/create-payment-intent` | POST   | Create Stripe PaymentIntent  |
| `/api/calculate-tax`         | POST   | Calculate tax via Stripe Tax |
| `/api/validate-promo`        | POST   | Validate promotion code      |
| `/api/webhook`               | POST   | Stripe webhook handler       |
| `/api/waitlist`              | POST   | Add to waitlist              |
| `/api/admin/orders`          | GET    | List orders (auth required)  |

## Deployment

### Vercel

1. Connect repository to Vercel
2. Set environment variables in Vercel dashboard
3. Deploy

### Stripe Webhook Setup

1. Go to [Stripe Dashboard > Webhooks](https://dashboard.stripe.com/webhooks)
2. Add endpoint: `https://your-domain.com/api/webhook`
3. Select events:
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed` (logged only)
   - `charge.refunded`, `refund.updated`, `charge.dispute.created` (license revocation; see `docs/LICENSING.md`)
4. Copy signing secret to `STRIPE_WEBHOOK_SECRET`

### Stripe Tax Setup

1. Go to [Stripe Dashboard > Tax](https://dashboard.stripe.com/tax/registrations)
2. Add your business address
3. Register for tax collection in applicable jurisdictions
4. Tax is automatically calculated based on customer location

### Creating Promo Codes

1. Go to [Stripe Dashboard > Coupons](https://dashboard.stripe.com/coupons)
2. Create coupon (e.g., 15% off)
3. Add promotion code (e.g., "EARLYBIRD")
4. Set restrictions as needed

## Scripts

```bash
npm run dev      # Start development server
npm run build    # Build for production
npm run preview  # Preview production build
npm run lint     # Run ESLint
```

## Design System

### Colors (from tailwind.config.js)

| Name       | Hex     | Usage             |
| ---------- | ------- | ----------------- |
| void       | #0a0a0f | Dark background   |
| panel      | #12121a | Card background   |
| instrument | #1a1a24 | Input background  |
| border     | #2a2a3a | Borders           |
| amber      | #f5a623 | Primary accent    |
| light      | #e8e8ec | Primary text      |
| muted      | #8a8a9a | Secondary text    |
| vfr        | #4ade80 | Success/VFR green |
| ifr        | #ef4444 | Error/IFR red     |

### Typography

- Display: "Instrument Serif" (headings)
- Body: "Inter" (body text)
- Mono: "JetBrains Mono" (data, code, prices)

## License

MIT - See LICENSE file
