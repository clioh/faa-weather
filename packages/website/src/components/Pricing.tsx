import { Link } from 'react-router-dom'
import { products, useCart, formatPrice, type Product } from '../store/cart'
import { canPurchase, isPreorderMode } from '../config/features'
import { FREE_SHIPPING_THRESHOLD_CENTS, centsToDollars } from '../../shared/catalog'

// Card order and short copy, from the site mockup.
const cards: { id: Product['id']; blurb: string }[] = [
  {
    id: 'complete-kit',
    blurb:
      '24" display with two-way mirror, Pi and license pre-installed. About 30 minutes to assemble.',
  },
  {
    id: 'hardware-kit',
    blurb: 'Bring your own mirror and frame. Detailed build instructions included.',
  },
  {
    id: 'software-license',
    blurb: 'For DIYers bringing their own Pi, display and mirror. Refundable within 30 days.',
  },
]

export function Pricing() {
  const { addItem } = useCart()
  const ecommerceEnabled = canPurchase()

  return (
    <section
      id="pricing"
      aria-labelledby="pricing-heading"
      className="flex scroll-mt-24 flex-col gap-10 pb-[120px]"
    >
      <h2 id="pricing-heading" className="display-2 m-0">
        Three ways aboard.
      </h2>
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-5 p-0">
        {cards.map(({ id, blurb }) => {
          const product = products.find((p) => p.id === id)
          if (!product) return null
          const highlighted = Boolean(product.popular)
          const buttonClass = `btn ${highlighted ? 'btn-primary' : 'btn-secondary'} h-12 w-full text-[15px]`

          return (
            <li
              key={product.id}
              className={`flex flex-col gap-5 rounded-[18px] border p-6 sm:p-8 ${
                highlighted ? 'border-accent bg-accent/5' : 'border-white/16'
              }`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="m-0 text-xl font-medium">{product.name}</h3>
                {highlighted && (
                  <div className="font-mono text-[11px] tracking-[0.1em] text-accent uppercase">
                    Most popular
                  </div>
                )}
              </div>
              <div>
                <div className="text-[44px] leading-tight font-extralight tracking-[-0.03em]">
                  {formatPrice(product.price)}
                </div>
                <div className="mt-1 text-[13px] text-fg-3">
                  {product.physical
                    ? isPreorderMode()
                      ? 'Pre-order, refundable until it ships'
                      : 'Ships in 2–3 weeks'
                    : 'Key delivered by email'}
                </div>
              </div>
              <p className="m-0 text-[15px] leading-[1.6] text-fg-2">{blurb}</p>
              <ul className="m-0 flex flex-1 list-none flex-col gap-2 p-0">
                {product.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5 text-sm text-fg-2">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                      className="mt-0.5 flex-none text-accent"
                    >
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                    {feature}
                  </li>
                ))}
              </ul>
              {ecommerceEnabled ? (
                <button
                  type="button"
                  onClick={() => addItem(product)}
                  className={buttonClass}
                  aria-label={`Add ${product.name} to cart`}
                >
                  Add to cart
                </button>
              ) : (
                <a href="#waitlist" className={buttonClass}>
                  Join the waitlist
                </a>
              )}
            </li>
          )
        })}
      </ul>
      <p className="m-0 text-sm text-fg-3">
        {ecommerceEnabled ? (
          <>
            Free shipping on orders over{' '}
            {formatPrice(centsToDollars(FREE_SHIPPING_THRESHOLD_CENTS))}. One license per mirror,
            transferable from{' '}
            <Link to="/license" className="link">
              your license page
            </Link>
            .{' '}
            <a href="mailto:hello@skyglass.dev" className="link">
              Questions?
            </a>
          </>
        ) : (
          <>
            Questions?{' '}
            <a href="mailto:hello@skyglass.dev" className="link">
              hello@skyglass.dev
            </a>
          </>
        )}
      </p>
    </section>
  )
}
