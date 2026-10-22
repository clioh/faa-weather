/**
 * Server-only product helpers. Product ids, names, prices and shipping rules
 * live in shared/catalog.ts (also used by the UI); never trust prices sent by
 * the client. Lives under api/_lib/ so Vercel does not deploy it.
 */

/** Stripe Tax codes, see https://stripe.com/docs/tax/tax-codes */
export const TAX_CODE_GOODS = 'txcd_99999999' // General - Tangible Goods
export const TAX_CODE_SHIPPING = 'txcd_92010001' // Shipping - Tangible goods
