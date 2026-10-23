# SkyGlass Website - Production Readiness Checklist

This document tracks all remaining work needed before the website is 100% production-ready.

## Legend

- [ ] Not started
- [~] In progress
- [x] Complete

---

## 1. Critical - Must Have for Launch

### Stripe Configuration

- [ ] Switch from test keys to live keys
- [ ] Set up production webhook endpoint
- [ ] Configure Stripe Tax registrations for applicable states
- [ ] Create launch promo codes (EARLYBIRD, WELCOME10, etc.)
- [ ] Verify payment flow end-to-end with live keys
- [ ] Set up Stripe Radar rules for fraud prevention

### Domain & Hosting

- [ ] Purchase/configure production domain (skyglass.dev or similar)
- [ ] Set up SSL certificate (automatic with Vercel)
- [ ] Configure DNS records
- [ ] Set up production environment variables in Vercel
- [ ] Enable Vercel Analytics for production

### Email Configuration

- [ ] Verify sending domain in Resend (DNS records)
- [ ] Set up proper "from" address (orders@skyglass.dev)
- [ ] Test order confirmation emails end-to-end
- [ ] Test payment failed emails
- [ ] Create Resend audience for customers (separate from waitlist)

### Legal & Compliance

- [ ] Review and finalize Privacy Policy content
- [ ] Review and finalize Terms of Service content
- [ ] Add cookie consent banner (if using tracking cookies)
- [ ] Ensure GDPR compliance for EU customers
- [ ] Add required disclosures for California customers (CCPA)

---

## 2. High Priority - Should Have for Launch

### Product & Pricing

- [ ] Add actual product images/renders to replace placeholders
- [ ] Create product gallery with multiple angles
- [ ] Finalize pricing ($99 software license, $349 hardware kit, $549 complete kit; set in `shared/catalog.ts`)
- [ ] Write detailed product descriptions
- [ ] Add product specs to pricing cards

### Shipping & Fulfillment

- [ ] Determine actual shipping costs by zone
- [ ] Set up shipping rate calculation (flat rate vs calculated)
- [ ] Define shipping zones (US only? International?)
- [ ] Set realistic delivery time estimates
- [ ] Create packing slip template

### Order Management

- [ ] Set up order notification emails (to admin)
- [ ] Create shipping notification email template
- [ ] Add tracking number input to admin dashboard
- [ ] Implement "Mark as Shipped" functionality
- [ ] Set up inventory tracking (or manual stock management)

### Error Handling & Monitoring

- [ ] Add Sentry or similar error monitoring
- [ ] Create error boundary components
- [ ] Add proper error pages (500, etc.)
- [ ] Set up alerts for failed payments

---

## 3. Medium Priority - Nice to Have for Launch

### User Experience

- [ ] Add loading skeleton states for async content
- [ ] Implement optimistic UI updates for cart
- [ ] Improve mobile checkout experience
- [ ] Add keyboard navigation for accessibility

### SEO & Marketing

- [ ] Submit sitemap to Google Search Console
- [ ] Create Open Graph images for social sharing
- [ ] Add structured data for products (JSON-LD)

### Performance

- [ ] Optimize images (WebP, proper sizing)
- [ ] Implement lazy loading for below-fold content
- [ ] Add resource hints (preconnect, prefetch)
- [ ] Review and improve Core Web Vitals
- [ ] Enable Vercel Edge caching where appropriate

### Testing

- [ ] Write unit tests for cart functionality
- [ ] Write integration tests for checkout flow
- [ ] Test on multiple browsers (Chrome, Safari, Firefox)
- [ ] Test on mobile devices (iOS Safari, Android Chrome)
- [ ] Perform accessibility audit (WAVE, axe)

---

## 4. Post-Launch Enhancements

### Customer Features

- [ ] Order status lookup page (no login required)
- [ ] Customer account system (optional)
- [ ] Order history for returning customers
- [ ] Wishlist / Save for later
- [ ] Product reviews and ratings

### Marketing Features

- [ ] Blog / Content section for SEO
- [ ] Referral program
- [ ] Abandoned cart recovery emails
- [ ] Newsletter signup integration
- [ ] Social proof (customer count, testimonials)

### Admin Features

- [ ] Proper authentication (OAuth, etc.)
- [ ] Order export (CSV, PDF)
- [ ] Sales analytics dashboard
- [ ] Inventory management
- [ ] Customer management

### International

- [ ] Currency conversion display
- [ ] International shipping rates
- [ ] Multi-language support (i18n)
- [ ] VAT handling for EU
- [ ] Localized content

---

## 5. Technical Debt & Improvements

### Infrastructure

- [ ] Set up staging environment
- [ ] Implement CI/CD pipeline (GitHub Actions)
- [ ] Add database for order persistence (currently Stripe-only)
- [ ] Set up log aggregation
- [ ] Create backup strategy for critical data

---

## Pre-Launch Checklist (Final Review)

### One Week Before Launch

- [ ] All critical items complete
- [ ] Test complete purchase flow with live Stripe
- [ ] Verify all emails sending correctly
- [ ] Review all copy for typos
- [ ] Test on multiple devices/browsers
- [ ] Prepare launch promo codes

### Day Before Launch

- [ ] Final environment variable check
- [ ] Verify DNS propagation
- [ ] Test webhook endpoint
- [ ] Clear any test data
- [ ] Prepare social media announcements

### Launch Day

- [ ] Enable e-commerce feature flag (`VITE_FEATURE_ECOMMERCE=true`)
- [ ] Monitor error logs
- [ ] Watch first few orders come through
- [ ] Respond to any customer issues immediately
- [ ] Celebrate! 🎉

---

## Current Status Summary

### Completed ✅

- Marketing website (Hero, Features, HowItWorks, Pricing, FAQ, Footer)
- SEO optimization with meta tags
- Waitlist functionality with Resend
- Cart system with Zustand
- Multi-step checkout with Stripe Elements
- Stripe Tax integration (location-based)
- Promo code support
- Order confirmation emails
- Payment failed emails
- Admin dashboard
- 404 page
- Privacy & Terms pages
- Vercel Analytics integration

### In Progress 🔄

- Product images (using placeholders)
- Final copy review
- Legal document review

### Not Started ❌

- Live Stripe configuration
- Domain setup
- Email domain verification
- Error monitoring
- Shipping notification emails
- Customer order lookup

---

## Estimated Effort

| Category        | Items | Est. Hours |
| --------------- | ----- | ---------- |
| Critical        | 10    | 8-12       |
| High Priority   | 12    | 16-24      |
| Medium Priority | 16    | 20-30      |
| Post-Launch     | 16    | 40+        |

**Minimum viable launch**: Complete Critical + High Priority items
**Estimated time to launch-ready**: 24-36 hours of focused work

---

## Notes

- The e-commerce system is fully functional behind a feature flag
- Stripe integration is complete and tested with test keys
- Tax calculation works with fallback if Stripe Tax not configured
- Admin dashboard provides basic order management
- All payment metadata is properly stored for fulfillment

Last updated: January 2025
