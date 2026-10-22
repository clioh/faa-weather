/**
 * Server-side checkout logic shared by calculate-tax, validate-promo and
 * create-payment-intent: cart pricing from the catalog, the tax address,
 * Stripe Tax calculations and promotion code checks. Nothing here trusts a
 * price, discount or tax figure sent by the client.
 *
 * Lives under api/_lib/ so Vercel does not deploy it as a function.
 */

import Stripe from 'stripe'
import {
  getCatalogProduct,
  needsShipping,
  parseBillingAddress,
  shippingCostFor,
  type ProductId,
} from '../../shared/catalog.js'
import { countPromoRedemptions, type Sql } from './db.js'
import { TAX_CODE_GOODS, TAX_CODE_SHIPPING } from './products.js'

/** Stripe's minimum charge for USD. */
export const MIN_CHARGE_CENTS = 50

// ---------------------------------------------------------------------------
// Cart
// ---------------------------------------------------------------------------

export interface PricedLine {
  productId: ProductId
  quantity: number
  unitPrice: number
}

export interface PricedCart {
  lines: PricedLine[]
  /** Merchandise subtotal in cents, before discounts. */
  subtotal: number
  ships: boolean
  /** Shipping fee in cents (threshold is on the pre-discount subtotal). */
  shippingCost: number
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

/** Price an untrusted `items` array from the catalog. */
export function priceCart(items: unknown): Result<PricedCart> {
  if (!Array.isArray(items) || items.length === 0) return { ok: false, error: 'No items provided' }
  if (items.length > 20) return { ok: false, error: 'Too many items' }
  const lines: PricedLine[] = []
  let subtotal = 0
  for (const raw of items) {
    const item = (raw && typeof raw === 'object' ? raw : {}) as { productId?: unknown; quantity?: unknown }
    const product = getCatalogProduct(item.productId)
    if (!product || !Number.isInteger(item.quantity)) {
      return { ok: false, error: `Invalid product: ${String(item.productId)}` }
    }
    const quantity = item.quantity as number
    if (quantity < 1 || quantity > 10) return { ok: false, error: 'Invalid quantity' }
    subtotal += product.priceCents * quantity
    lines.push({ productId: product.id, quantity, unitPrice: product.priceCents })
  }
  const ships = needsShipping(lines)
  return { ok: true, value: { lines, subtotal, ships, shippingCost: shippingCostFor(lines, subtotal) } }
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

export interface PostalAddress {
  line1: string
  line2?: string
  city: string
  state: string
  postal_code: string
  country: string
}

function text(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t && t.length <= max ? t : null
}

/** Validates an untrusted shipping address; state and line2 are optional. */
export function parsePostalAddress(value: unknown): PostalAddress | null {
  if (!value || typeof value !== 'object') return null
  const a = value as Record<string, unknown>
  const line1 = text(a.line1, 200)
  const city = text(a.city, 100)
  const postal = text(a.postal_code, 20)
  const country = text(a.country, 2)
  if (!line1 || !city || !postal || !country || !/^[A-Za-z]{2}$/.test(country)) return null
  return {
    line1,
    line2: text(a.line2, 200) ?? undefined,
    city,
    state: text(a.state, 100) ?? '',
    postal_code: postal,
    country: country.toUpperCase(),
  }
}

export interface TaxAddress {
  address: Stripe.Tax.CalculationCreateParams.CustomerDetails.Address
  source: 'shipping' | 'billing'
}

/**
 * The address sales tax is charged on: the shipping address when anything
 * ships, else the buyer's billing ZIP (license-only carts).
 */
export function resolveTaxAddress(ships: boolean, shipping: unknown, billingAddress: unknown): Result<TaxAddress> {
  if (ships) {
    const address = parsePostalAddress(shipping)
    if (!address) return { ok: false, error: 'Shipping address required' }
    return { ok: true, value: { address, source: 'shipping' } }
  }
  const billing = parseBillingAddress(billingAddress)
  if (!billing) return { ok: false, error: 'A valid US ZIP code is required' }
  return { ok: true, value: { address: billing, source: 'billing' } }
}

// ---------------------------------------------------------------------------
// Tax
// ---------------------------------------------------------------------------

/**
 * Split `discount` across lines in proportion to their totals (largest
 * remainder), so the per-line amounts sum to exactly subtotal - discount.
 */
export function discountedLineAmounts(lines: PricedLine[], discount: number): number[] {
  const totals = lines.map((l) => l.unitPrice * l.quantity)
  const subtotal = totals.reduce((a, b) => a + b, 0)
  const d = Math.max(0, Math.min(discount, subtotal))
  if (d === 0 || subtotal === 0) return totals
  const exact = totals.map((t) => (t * d) / subtotal)
  const shares = exact.map(Math.floor)
  let left = d - shares.reduce((a, b) => a + b, 0)
  const order = exact.map((e, i) => ({ i, frac: e - Math.floor(e) })).sort((a, b) => b.frac - a.frac)
  for (const { i } of order) {
    if (left <= 0) break
    shares[i] += 1
    left -= 1
  }
  return totals.map((t, i) => t - shares[i])
}

export interface TaxQuote {
  calculation: Stripe.Tax.Calculation
  /** Total tax in cents (tax-exclusive pricing). */
  tax: number
  /** Portion of `tax` charged on shipping. */
  shippingTax: number
}

/**
 * One Stripe Tax calculation for the cart: merchandise lines after the
 * discount, shipping as shipping_cost, on the given tax address. Throws
 * Stripe errors to the caller.
 */
export async function calculateCartTax(
  stripe: Stripe,
  cart: PricedCart,
  discount: number,
  taxAddress: TaxAddress,
): Promise<TaxQuote> {
  const amounts = discountedLineAmounts(cart.lines, discount)
  const calculation = await stripe.tax.calculations.create({
    currency: 'usd',
    line_items: cart.lines.map((line, i) => ({
      amount: amounts[i],
      quantity: 1, // amount already includes quantity
      reference: `${line.productId}:${i + 1}`,
      tax_code: TAX_CODE_GOODS,
      tax_behavior: 'exclusive',
    })),
    ...(cart.shippingCost > 0
      ? { shipping_cost: { amount: cart.shippingCost, tax_code: TAX_CODE_SHIPPING, tax_behavior: 'exclusive' as const } }
      : {}),
    customer_details: {
      address: taxAddress.address,
      address_source: taxAddress.source,
    },
  })
  return {
    calculation,
    tax: calculation.tax_amount_exclusive,
    shippingTax: calculation.shipping_cost?.amount_tax ?? 0,
  }
}

/** Stripe Tax rejected the address itself: the buyer should correct it. */
export function isTaxLocationError(error: unknown): boolean {
  return error instanceof Stripe.errors.StripeError && error.code === 'customer_tax_location_invalid'
}

// ---------------------------------------------------------------------------
// Promotion codes
// ---------------------------------------------------------------------------

const PROMO_EXPAND = ['promotion.coupon', 'promotion.coupon.applies_to', 'customer']

export interface PromoDiscount {
  promotionCodeId: string
  couponId: string
  code: string
  discountType: 'percent' | 'amount'
  percentOff?: number
  amountOff?: number
  /** Discount in cents on the given subtotal. */
  discountAmount: number
  name?: string
}

/** An active promotion code by its customer-facing code, or null. */
export async function findPromotionCode(stripe: Stripe, code: string): Promise<Stripe.PromotionCode | null> {
  const list = await stripe.promotionCodes.list({ code, active: true, limit: 1, expand: PROMO_EXPAND.map((p) => `data.${p}`) })
  return list.data[0] ?? null
}

/** A promotion code by id, or null when it doesn't exist. */
export async function retrievePromotionCode(stripe: Stripe, id: string): Promise<Stripe.PromotionCode | null> {
  if (!/^promo_[A-Za-z0-9]+$/.test(id)) return null
  try {
    return await stripe.promotionCodes.retrieve(id, { expand: PROMO_EXPAND })
  } catch (err) {
    if (err instanceof Stripe.errors.StripeInvalidRequestError && err.code === 'resource_missing') return null
    throw err
  }
}

export interface PromoContext {
  /** Merchandise subtotal in cents, before discounts. */
  subtotal: number
  /**
   * Buyer email (lowercased). When given, a code restricted to one customer
   * must match it. validate-promo may not know the email yet; checkout always
   * passes it, so the restriction is always enforced before payment.
   */
  email?: string
  /** For counting our own redemptions; null when the database isn't configured. */
  sql: Sql | null
}

/**
 * Every restriction Stripe would enforce on a Checkout/Invoice redemption,
 * re-checked here because a PaymentIntent doesn't redeem the code. Used by
 * validate-promo (display) and create-payment-intent (authoritative).
 */
export async function evaluatePromotion(
  promotionCode: Stripe.PromotionCode | null,
  ctx: PromoContext,
): Promise<Result<PromoDiscount>> {
  const invalid = (error: string): Result<PromoDiscount> => ({ ok: false, error })
  if (!promotionCode) return invalid('Invalid promo code')
  const coupon = promotionCode.promotion.coupon
  const now = Math.floor(Date.now() / 1000)

  if (!promotionCode.active) return invalid('This promo code is no longer active')
  if (!coupon || typeof coupon === 'string' || !coupon.valid) return invalid('This promo code has expired')
  if (promotionCode.expires_at && promotionCode.expires_at <= now) return invalid('This promo code has expired')

  // Our products are not Stripe products, so a product-restricted coupon can't apply.
  if (coupon.applies_to && coupon.applies_to.products.length > 0) {
    return invalid('This promo code does not apply to these products')
  }

  // We can't tell a first purchase from a repeat one the way Stripe does
  // (that needs a Stripe customer's payment history), so these codes are rejected.
  if (promotionCode.restrictions.first_time_transaction) {
    return invalid('This promo code is not valid for online orders')
  }

  const { minimum_amount: minimum, minimum_amount_currency: minimumCurrency } = promotionCode.restrictions
  if (minimum) {
    if (minimumCurrency && minimumCurrency.toLowerCase() !== 'usd') {
      return invalid('This promo code is not valid for USD orders')
    }
    if (ctx.subtotal < minimum) {
      return invalid(`Minimum order of $${(minimum / 100).toFixed(2)} required for this code`)
    }
  }

  const restrictedTo = promotionCode.customer
  if (restrictedTo && ctx.email !== undefined) {
    const restrictedEmail =
      typeof restrictedTo === 'object' && !('deleted' in restrictedTo && restrictedTo.deleted)
        ? (restrictedTo as Stripe.Customer).email
        : null
    if (!restrictedEmail || restrictedEmail.trim().toLowerCase() !== ctx.email) {
      return invalid('This promo code is not valid for this email address')
    }
  }

  // PaymentIntents don't redeem codes, so add our own count of paid orders.
  const limited = Boolean(promotionCode.max_redemptions || coupon.max_redemptions)
  if (limited) {
    if (!ctx.sql) {
      console.error('[Promo] DATABASE_URL not configured; cannot enforce max_redemptions')
      return invalid('This promo code is not available right now')
    }
    const used = await countPromoRedemptions(ctx.sql, promotionCode.id, coupon.id)
    if (promotionCode.max_redemptions && promotionCode.times_redeemed + used.promotionCode >= promotionCode.max_redemptions) {
      return invalid('This promo code has reached its usage limit')
    }
    if (coupon.max_redemptions && coupon.times_redeemed + used.coupon >= coupon.max_redemptions) {
      return invalid('This promo code has reached its usage limit')
    }
  }

  let discountAmount: number
  let discountType: 'percent' | 'amount'
  if (coupon.percent_off) {
    discountType = 'percent'
    discountAmount = Math.round(ctx.subtotal * (coupon.percent_off / 100))
  } else if (coupon.amount_off) {
    if ((coupon.currency ?? '').toLowerCase() !== 'usd') return invalid('This promo code is not valid for USD orders')
    discountType = 'amount'
    discountAmount = coupon.amount_off
  } else {
    return invalid('Invalid promo code')
  }

  return {
    ok: true,
    value: {
      promotionCodeId: promotionCode.id,
      couponId: coupon.id,
      code: promotionCode.code.toUpperCase(),
      discountType,
      percentOff: coupon.percent_off ?? undefined,
      amountOff: coupon.amount_off ?? undefined,
      // Never more than the merchandise subtotal.
      discountAmount: Math.max(0, Math.min(discountAmount, ctx.subtotal)),
      name: coupon.name ?? undefined,
    },
  }
}
