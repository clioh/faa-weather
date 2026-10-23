import { type CartItem, formatPrice } from '../../store/cart'

interface PromoData {
  code: string
  discountType: 'percent' | 'amount' | null
  percentOff: number | null
  amountOff: number | null
  discountAmount: number
}

interface OrderSummaryProps {
  items: CartItem[]
  subtotal: number
  discount: number
  shipping: number
  tax: number
  total: number
  taxSource: 'stripe_tax' | 'fallback' | 'estimating'
  promoData?: PromoData | null
  onRemovePromo?: () => void
}

export function OrderSummary({
  items,
  subtotal,
  discount,
  shipping,
  tax,
  total,
  taxSource,
  promoData,
  onRemovePromo,
}: OrderSummaryProps) {
  const isFreeShipping = shipping === 0

  return (
    <div className="panel p-5 sm:p-7 lg:sticky lg:top-6">
      {/* Items */}
      <ul className="pb-2">
        {items.map((item) => (
          <li key={item.product.id} className="flex gap-4 py-4 border-b border-line last:border-b-0">
            <div className="w-14 h-14 rounded-xl border border-line bg-tint flex items-center justify-center flex-shrink-0">
              <svg className="w-7 h-7 text-fg-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="2" width="18" height="20" rx="2" strokeWidth={1.5} />
                <circle cx="18" cy="5" r="1.5" fill="currentColor" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-fg font-medium truncate">{item.product.name}</p>
              <p className="text-sm text-fg-2">
                Qty: <span className="font-mono">{item.quantity}</span>
              </p>
            </div>
            <p className="font-mono text-fg">{formatPrice(item.product.price * item.quantity)}</p>
          </li>
        ))}
      </ul>

      {/* Totals: hairline rows */}
      <dl className="text-sm">
        <div className="flex justify-between gap-4 py-3 border-t border-line">
          <dt className="text-fg-2">Subtotal</dt>
          <dd className="font-mono text-fg">{formatPrice(subtotal)}</dd>
        </div>

        {/* Promo discount */}
        {promoData && promoData.discountAmount > 0 && (
          <div className="flex items-center justify-between gap-4 py-1 border-t border-line">
            <dt className="flex items-center gap-1 text-fg-2">
              Discount (<span className="font-mono">{promoData.code}</span>)
              {onRemovePromo && (
                <button
                  onClick={onRemovePromo}
                  className="w-11 h-11 flex items-center justify-center rounded-full text-fg-3 hover:text-danger transition-colors"
                  aria-label="Remove promo code"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </dt>
            <dd className="font-mono text-fg">-{formatPrice(discount)}</dd>
          </div>
        )}

        <div className="flex items-center justify-between gap-4 py-3 border-t border-line">
          <dt className="flex items-center gap-2 text-fg-2">
            Shipping
            {isFreeShipping && <span className="badge">FREE</span>}
          </dt>
          <dd className="font-mono text-fg">{isFreeShipping ? 'Free' : formatPrice(shipping)}</dd>
        </div>

        <div className="flex justify-between gap-4 py-3 border-t border-line">
          <dt className="flex items-center gap-1 text-fg-2">
            Tax
            {taxSource === 'estimating' && <span className="text-xs text-fg-3">(estimated)</span>}
          </dt>
          <dd className="font-mono text-fg">{formatPrice(tax)}</dd>
        </div>

        <div className="flex items-baseline justify-between gap-4 pt-4 pb-1 border-t border-line-strong">
          <dt className="text-base font-medium text-fg">Total</dt>
          <dd className="font-mono text-2xl font-light text-fg">{formatPrice(total)}</dd>
        </div>
      </dl>
    </div>
  )
}
