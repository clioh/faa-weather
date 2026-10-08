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
    <div className="instrument-card p-6 lg:sticky lg:top-6">
      {/* Items */}
      <div className="space-y-4 pb-6 border-b border-border">
        {items.map((item) => (
          <div key={item.product.id} className="flex gap-4">
            <div className="w-16 h-16 bg-panel border border-border rounded-lg flex items-center justify-center flex-shrink-0">
              <svg className="w-8 h-8 text-amber/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <rect x="3" y="2" width="18" height="20" rx="2" strokeWidth={1.5} />
                <circle cx="18" cy="5" r="1.5" fill="currentColor" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-light font-medium truncate">{item.product.name}</p>
              <p className="text-sm text-muted">Qty: {item.quantity}</p>
            </div>
            <p className="text-light font-medium">{formatPrice(item.product.price * item.quantity)}</p>
          </div>
        ))}
      </div>

      {/* Totals */}
      <div className="pt-6 space-y-3">
        <div className="flex justify-between text-muted">
          <span>Subtotal</span>
          <span>{formatPrice(subtotal)}</span>
        </div>

        {/* Promo discount */}
        {promoData && promoData.discountAmount > 0 && (
          <div className="flex justify-between text-green-400">
            <span className="flex items-center gap-2">
              Discount ({promoData.code})
              {onRemovePromo && (
                <button
                  onClick={onRemovePromo}
                  className="text-muted hover:text-ifr transition-colors"
                  aria-label="Remove promo code"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </span>
            <span>-{formatPrice(discount)}</span>
          </div>
        )}

        <div className="flex justify-between text-muted">
          <span className="flex items-center gap-2">
            Shipping
            {isFreeShipping && (
              <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">FREE</span>
            )}
          </span>
          <span>{isFreeShipping ? 'Free' : formatPrice(shipping)}</span>
        </div>

        <div className="flex justify-between text-muted">
          <span className="flex items-center gap-1">
            Tax
            {taxSource === 'estimating' && <span className="text-xs text-muted">(estimated)</span>}
          </span>
          <span>{formatPrice(tax)}</span>
        </div>

        <div className="flex justify-between text-light font-bold text-lg pt-3 border-t border-border">
          <span>Total</span>
          <span>{formatPrice(total)}</span>
        </div>
      </div>
    </div>
  )
}
