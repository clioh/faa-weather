/**
 * Product catalog: the single source of truth for product ids, names, prices
 * and shipping rules. Imported by the site UI (src/) and the Vercel functions
 * (api/).
 *
 * Keep this file dependency-free and runtime-neutral (no DOM, no Node APIs):
 * it is compiled by Vite for the browser and by @vercel/node for functions.
 * Imports from api/ must use the `.js` extension (ESM at runtime).
 *
 * Prices are in cents. The server charges these amounts; the UI derives its
 * dollar figures from them. Keep the products in Stripe in sync.
 */

export const PRODUCT_IDS = ['software-license', 'hardware-kit', 'complete-kit'] as const
export type ProductId = (typeof PRODUCT_IDS)[number]

export interface CatalogProduct {
  id: ProductId
  /** Display name without the brand, e.g. "Hardware Kit". */
  name: string
  /** Unit price in cents. */
  priceCents: number
  /** Physical shipment. A cart with no physical items needs no shipping address or fee. */
  physical: boolean
}

export const CATALOG: Readonly<Record<ProductId, CatalogProduct>> = {
  'software-license': {
    id: 'software-license',
    name: 'Software License',
    priceCents: 9900, // $99
    physical: false,
  },
  'hardware-kit': {
    id: 'hardware-kit',
    name: 'Hardware Kit',
    priceCents: 34900, // $349
    physical: true,
  },
  'complete-kit': {
    id: 'complete-kit',
    name: 'Complete Kit',
    priceCents: 54900, // $549
    physical: true,
  },
}

/** Flat shipping fee in cents for carts that ship and are under the threshold. */
export const SHIPPING_COST_CENTS = 2500 // $25
/** Merchandise subtotal (cents, before discounts) at which shipping becomes free. */
export const FREE_SHIPPING_THRESHOLD_CENTS = 50000 // $500
/**
 * How long a kit takes to ship once ordered (outside pre-order mode). The one
 * place this promise lives: Pricing, the checkout success page and the order
 * confirmation email all read it.
 */
export const KIT_SHIP_LEAD_TIME = '2–3 weeks'

/** DIY build guide (assembly + setup script) and the bill of materials, in the public repo. */
export const BUILD_GUIDE_URL = 'https://github.com/clioh/skyglass/blob/main/docs/HARDWARE.md'
export const BOM_PDF_URL =
  'https://github.com/clioh/skyglass/blob/main/docs/build-guide/SkyGlass-Bill-of-Materials.pdf'

/** Tax rate used only when Stripe Tax is unavailable or errors. */
export const FALLBACK_TAX_RATE = 0.0875 // 8.75%

export function isProductId(id: unknown): id is ProductId {
  return typeof id === 'string' && (PRODUCT_IDS as readonly string[]).includes(id)
}

export function getCatalogProduct(id: unknown): CatalogProduct | undefined {
  return isProductId(id) ? CATALOG[id] : undefined
}

/** Name with the brand, for receipts and emails, e.g. "SkyGlass Hardware Kit". */
export function fullProductName(id: ProductId): string {
  return `SkyGlass ${CATALOG[id].name}`
}

/** Whether any item in the cart is a physical product. Unknown ids are treated as shipping. */
export function needsShipping(items: readonly { productId: string }[]): boolean {
  return items.some((item) => getCatalogProduct(item.productId)?.physical !== false)
}

/** Shipping fee in cents: zero when nothing ships, else free over the threshold. */
export function shippingCostFor(
  items: readonly { productId: string }[],
  subtotalCents: number
): number {
  if (!needsShipping(items)) return 0
  return subtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS ? 0 : SHIPPING_COST_CENTS
}

export function centsToDollars(cents: number): number {
  return cents / 100
}

// ---------------------------------------------------------------------------
// Billing address for carts with nothing to ship (tax is based on the buyer's ZIP)
// ---------------------------------------------------------------------------

/** Sent as `billingAddress` by checkout for a cart with no physical items. US only. */
export interface BillingAddress {
  postal_code: string
  country: 'US'
}

/** 5-digit ZIP or ZIP+4. */
export const US_ZIP_PATTERN = /^\d{5}(?:-\d{4})?$/

export function isUsZip(value: unknown): value is string {
  return typeof value === 'string' && US_ZIP_PATTERN.test(value)
}

/** Validates an untrusted `billingAddress` payload; returns null if it is not a US ZIP. */
export function parseBillingAddress(value: unknown): BillingAddress | null {
  if (!value || typeof value !== 'object') return null
  const { postal_code, country } = value as Record<string, unknown>
  const zip = typeof postal_code === 'string' ? postal_code.trim() : ''
  if (country !== 'US' || !isUsZip(zip)) return null
  return { postal_code: zip, country: 'US' }
}
