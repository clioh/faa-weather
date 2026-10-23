import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { CATALOG, centsToDollars, type ProductId } from '../../shared/catalog'

export interface Product {
  id: ProductId
  name: string
  shortName: string
  description: string
  /** Unit price in dollars, derived from shared/catalog.ts. */
  price: number
  features: string[]
  /** True when the product is a physical shipment. A cart with no physical items needs no address. */
  physical: boolean
  /** The card the storefront highlights as the one to get. A recommendation, not a sales ranking. */
  recommended?: boolean
}

export interface CartItem {
  product: Product
  quantity: number
}

interface CartState {
  items: CartItem[]
  isOpen: boolean
  addItem: (product: Product) => void
  removeItem: (productId: string) => void
  updateQuantity: (productId: string, quantity: number) => void
  clearCart: () => void
  openCart: () => void
  closeCart: () => void
  toggleCart: () => void
  total: () => number
  itemCount: () => number
}

// Storefront copy for each product. Ids, names, prices and the physical flag
// come from shared/catalog.ts, which the server charges from.
const storefront = (
  id: ProductId,
  copy: Omit<Product, 'id' | 'name' | 'price' | 'physical'>
): Product => ({
  id,
  name: CATALOG[id].name,
  price: centsToDollars(CATALOG[id].priceCents),
  physical: CATALOG[id].physical,
  ...copy,
})

export const products: Product[] = [
  storefront('software-license', {
    shortName: 'License',
    description: 'For makers with their own Pi, display, and mirror',
    features: [
      'License for one mirror',
      'Setup script for Raspberry Pi OS',
      'Build guide and parts list',
      'Companion app',
      'Email support',
    ],
  }),
  storefront('hardware-kit', {
    shortName: 'Kit',
    description: 'Electronics + software, bring your own mirror',
    features: [
      'Raspberry Pi 5 (4GB)',
      'Pi Camera Module 3',
      'Power supply + cables',
      'Pre-flashed SD card',
      'SkyGlass license pre-installed',
      'Email support',
    ],
  }),
  storefront('complete-kit', {
    shortName: 'Complete',
    description: 'Everything you need, ready to mount',
    features: [
      'Everything in Hardware Kit',
      'SkyGlass license pre-installed',
      '24" IPS display (1080p)',
      'Two-way mirror glass',
      'Aluminum frame',
      'Wall mount hardware',
      'Priority support',
    ],
    recommended: true,
  }),
]

export const getProduct = (id: string | undefined) => products.find((p) => p.id === id)

/** Most units of one product per order; the checkout API rejects more. */
export const MAX_QUANTITY_PER_ITEM = 10
const clampQuantity = (quantity: number) =>
  Math.min(MAX_QUANTITY_PER_ITEM, Math.max(1, Math.floor(quantity)))

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      isOpen: false,

      addItem: (product) => {
        set((state) => {
          const existingItem = state.items.find((item) => item.product.id === product.id)
          if (existingItem) {
            return {
              items: state.items.map((item) =>
                item.product.id === product.id
                  ? { ...item, quantity: clampQuantity(item.quantity + 1) }
                  : item
              ),
              isOpen: true, // Open cart when adding
            }
          }
          return {
            items: [...state.items, { product, quantity: 1 }],
            isOpen: true, // Open cart when adding
          }
        })
      },

      removeItem: (productId) => {
        set((state) => ({
          items: state.items.filter((item) => item.product.id !== productId),
        }))
      },

      updateQuantity: (productId, quantity) => {
        if (quantity <= 0) {
          get().removeItem(productId)
          return
        }
        set((state) => ({
          items: state.items.map((item) =>
            item.product.id === productId ? { ...item, quantity: clampQuantity(quantity) } : item
          ),
        }))
      },

      clearCart: () => set({ items: [] }),
      openCart: () => set({ isOpen: true }),
      closeCart: () => set({ isOpen: false }),
      toggleCart: () => set((state) => ({ isOpen: !state.isOpen })),

      total: () => {
        return get().items.reduce((sum, item) => sum + item.product.price * item.quantity, 0)
      },

      itemCount: () => {
        return get().items.reduce((sum, item) => sum + item.quantity, 0)
      },
    }),
    {
      name: 'skyglass-cart',
      // v2: catalog renamed software-only -> software-license (now paid). Drop older carts.
      version: 2,
      migrate: () => ({ items: [] }),
      partialize: (state) => ({ items: state.items }), // Only persist items
      // Re-resolve stored items against the current catalog so a persisted cart
      // never shows a stale price or name; unknown products are dropped.
      merge: (persisted, current) => {
        const stored = (persisted as Partial<Pick<CartState, 'items'>> | undefined)?.items ?? []
        const items: CartItem[] = []
        for (const item of stored) {
          const product = getProduct(item?.product?.id)
          if (product && Number.isInteger(item.quantity) && item.quantity > 0) {
            items.push({ product, quantity: clampQuantity(item.quantity) })
          }
        }
        return { ...current, items }
      },
    }
  )
)

/** Whether any item in the cart has to be shipped. Software-only carts need no address or shipping charge. */
export const cartRequiresShipping = (items: CartItem[]) =>
  items.some((item) => item.product.physical)

// Whole dollars print without cents ($549); anything else always shows two ($56.70).
export const formatPrice = (price: number) => {
  const fractionDigits = Number.isInteger(price) ? 0 : 2
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(price)
}
