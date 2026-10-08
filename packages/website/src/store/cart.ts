import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface Product {
  id: string
  name: string
  shortName: string
  description: string
  price: number
  features: string[]
  badge?: string
  popular?: boolean
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

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      isOpen: false,

      addItem: (product) => {
        // Don't add free items to cart
        if (product.price === 0) return

        set((state) => {
          const existingItem = state.items.find(
            (item) => item.product.id === product.id
          )
          if (existingItem) {
            return {
              items: state.items.map((item) =>
                item.product.id === product.id
                  ? { ...item, quantity: item.quantity + 1 }
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
            item.product.id === productId ? { ...item, quantity } : item
          ),
        }))
      },

      clearCart: () => set({ items: [] }),
      openCart: () => set({ isOpen: true }),
      closeCart: () => set({ isOpen: false }),
      toggleCart: () => set((state) => ({ isOpen: !state.isOpen })),

      total: () => {
        return get().items.reduce(
          (sum, item) => sum + item.product.price * item.quantity,
          0
        )
      },

      itemCount: () => {
        return get().items.reduce((sum, item) => sum + item.quantity, 0)
      },
    }),
    {
      name: 'skyglass-cart',
      partialize: (state) => ({ items: state.items }), // Only persist items
    }
  )
)

// Products catalog - matches Pricing component
export const products: Product[] = [
  {
    id: 'software-only',
    name: 'Software Only',
    shortName: 'Software',
    description: 'For experienced makers with their own hardware',
    price: 0,
    features: [
      'SkyGlass OS image',
      'Companion app access',
      'Community support',
      'DIY documentation',
    ],
    badge: 'Free',
  },
  {
    id: 'hardware-kit',
    name: 'Hardware Kit',
    shortName: 'Kit',
    description: 'Electronics + software, bring your own mirror',
    price: 349,
    features: [
      'Raspberry Pi 5 (4GB)',
      'Pi Camera Module 3',
      'Power supply + cables',
      'Pre-flashed SD card',
      'SkyGlass software license',
      'Email support',
    ],
  },
  {
    id: 'complete-kit',
    name: 'Complete Kit',
    shortName: 'Complete',
    description: 'Everything you need, ready to mount',
    price: 549,
    features: [
      'Everything in Hardware Kit',
      '24" IPS display (1080p)',
      'Two-way mirror glass',
      'Aluminum frame',
      'Wall mount hardware',
      'Priority support',
    ],
    popular: true,
    badge: 'Most Popular',
  },
]

export const getProduct = (id: string) => products.find((p) => p.id === id)

export const formatPrice = (price: number) => {
  if (price === 0) return 'Free'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(price)
}
