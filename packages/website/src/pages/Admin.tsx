import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { PageHeader } from '../components'

interface OrderItem {
  name: string
  quantity: number
  price: number
}

interface Order {
  id: string
  email: string
  amount: number
  status: string
  items: OrderItem[]
  shipping: {
    name: string
    address: string
  } | null
  createdAt: string
}

interface Stats {
  totalOrders: number
  totalRevenue: number
  pendingOrders: number
}

interface OrdersResponse {
  orders: Order[]
  stats: Stats
  hasMore: boolean
  nextCursor: string | null
}

// `bg` colours the status dot, `text` the label. Paid uses the accent (success), never green.
const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  succeeded: { bg: 'bg-accent', text: 'text-accent', label: 'Paid' },
  processing: { bg: 'bg-warning', text: 'text-warning', label: 'Processing' },
  requires_payment_method: { bg: 'bg-fg-3', text: 'text-fg-2', label: 'Pending' },
  requires_confirmation: { bg: 'bg-warning', text: 'text-warning', label: 'Confirming' },
  requires_action: { bg: 'bg-warning', text: 'text-warning', label: 'Action required' },
  canceled: { bg: 'bg-danger', text: 'text-danger', label: 'Canceled' },
}

const DEFAULT_STATUS_STYLE = { bg: 'bg-fg-3', text: 'text-fg-2' }

function StatusLabel({ style }: { style: { bg: string; text: string; label: string } }) {
  return (
    <span className={`inline-flex items-center gap-2 text-sm whitespace-nowrap ${style.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${style.bg}`} aria-hidden="true" />
      {style.label}
    </span>
  )
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100)
}

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function Admin() {
  const [password, setPassword] = useState('')
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [authError, setAuthError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const [orders, setOrders] = useState<Order[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)

  // Check for stored auth
  useEffect(() => {
    const storedAuth = sessionStorage.getItem('admin_auth')
    if (storedAuth) {
      setPassword(storedAuth)
      setIsAuthenticated(true)
    }
  }, [])

  const fetchOrders = useCallback(
    async (cursor?: string) => {
      if (!password) return

      setIsLoading(true)
      try {
        const params = new URLSearchParams({
          limit: '25',
          status: statusFilter,
        })
        if (cursor) {
          params.set('starting_after', cursor)
        }

        const response = await fetch(`/api/admin/orders?${params}`, {
          headers: {
            Authorization: `Bearer ${password}`,
          },
        })

        if (!response.ok) {
          if (response.status === 401) {
            setIsAuthenticated(false)
            sessionStorage.removeItem('admin_auth')
            setAuthError('Session expired')
          }
          throw new Error('Failed to fetch orders')
        }

        const data: OrdersResponse = await response.json()

        if (cursor) {
          setOrders((prev) => [...prev, ...data.orders])
        } else {
          setOrders(data.orders)
        }

        setStats(data.stats)
        setHasMore(data.hasMore)
        setNextCursor(data.nextCursor)
      } catch (error) {
        console.error('Failed to fetch orders:', error)
      } finally {
        setIsLoading(false)
      }
    },
    [password, statusFilter]
  )

  // Fetch orders when authenticated or filter changes
  useEffect(() => {
    if (isAuthenticated) {
      fetchOrders()
    }
  }, [isAuthenticated, statusFilter, fetchOrders])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthError('')
    setIsLoading(true)

    try {
      const response = await fetch('/api/admin/orders?limit=1', {
        headers: {
          Authorization: `Bearer ${password}`,
        },
      })

      if (response.ok) {
        sessionStorage.setItem('admin_auth', password)
        setIsAuthenticated(true)
      } else {
        setAuthError('Invalid password')
      }
    } catch {
      setAuthError('Connection error')
    } finally {
      setIsLoading(false)
    }
  }

  const handleLogout = () => {
    setIsAuthenticated(false)
    setPassword('')
    setOrders([])
    setStats(null)
    sessionStorage.removeItem('admin_auth')
  }

  // Login screen
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-bg flex flex-col">
        <PageHeader />
        <main className="flex-1 flex items-center justify-center px-4 pb-24">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-sm"
          >
            <h1 className="display-3 text-fg mb-8">Admin dashboard</h1>

            <form onSubmit={handleLogin} className="space-y-6">
              <div>
                <label htmlFor="admin-password" className="field-label">
                  Password
                </label>
                <input
                  id="admin-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={authError ? 'true' : undefined}
                  className="field-input"
                  placeholder="Enter admin password"
                  autoFocus
                />
                {authError && <p className="field-error">{authError}</p>}
              </div>

              <button type="submit" disabled={isLoading || !password} className="btn btn-primary w-full">
                {isLoading ? 'Authenticating...' : 'Login'}
              </button>
            </form>
          </motion.div>
        </main>
      </div>
    )
  }

  // Dashboard
  return (
    <div className="min-h-screen bg-bg">
      <PageHeader
        right={
          <div className="flex items-center gap-4">
            <span className="section-label">Admin</span>
            <button
              onClick={handleLogout}
              className="text-sm text-fg-2 hover:text-fg transition-colors min-h-11 inline-flex items-center"
            >
              Logout
            </button>
          </div>
        }
      />

      <main className="site-container pt-4 pb-16">
        {/* Stats */}
        {stats && (
          <motion.dl
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-1 sm:grid-cols-3 border-b border-line mb-10"
          >
            <div className="border-t border-line py-5 sm:pr-6">
              <dt className="section-label mb-2">Total orders</dt>
              <dd className="text-4xl font-extralight text-fg font-mono">{stats.totalOrders}</dd>
            </div>
            <div className="border-t border-line py-5 sm:px-6 sm:border-l">
              <dt className="section-label mb-2">Revenue</dt>
              <dd className="text-4xl font-extralight text-fg font-mono">{formatCurrency(stats.totalRevenue)}</dd>
            </div>
            <div className="border-t border-line py-5 sm:pl-6 sm:border-l">
              <dt className="section-label mb-2">Pending</dt>
              <dd className={`text-4xl font-extralight font-mono ${stats.pendingOrders > 0 ? 'text-warning' : 'text-fg'}`}>
                {stats.pendingOrders}
              </dd>
            </div>
          </motion.dl>
        )}

        {/* Filters */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-xl font-normal text-fg">Orders</h2>
          <div className="flex items-center gap-3">
            <label htmlFor="admin-status-filter" className="text-sm text-fg-2">
              Status:
            </label>
            <select
              id="admin-status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="field-input h-11 w-auto pr-10 text-sm"
            >
              <option value="all">All</option>
              <option value="succeeded">Paid</option>
              <option value="processing">Processing</option>
              <option value="requires_payment_method">Pending</option>
              <option value="canceled">Canceled</option>
            </select>
          </div>
        </div>

        {/* Orders Table */}
        <div className="border-b border-line">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr>
                  <th className="section-label text-left font-medium px-3 py-3">Order</th>
                  <th className="section-label text-left font-medium px-3 py-3">Customer</th>
                  <th className="section-label text-left font-medium px-3 py-3">Items</th>
                  <th className="section-label text-left font-medium px-3 py-3">Amount</th>
                  <th className="section-label text-left font-medium px-3 py-3">Status</th>
                  <th className="section-label text-left font-medium px-3 py-3">Date</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && orders.length === 0 ? (
                  <tr className="border-t border-line">
                    <td colSpan={6} className="px-3 py-12 text-center text-fg-2">
                      Loading orders...
                    </td>
                  </tr>
                ) : orders.length === 0 ? (
                  <tr className="border-t border-line">
                    <td colSpan={6} className="px-3 py-12 text-center text-fg-2">
                      No orders found
                    </td>
                  </tr>
                ) : (
                  orders.map((order) => {
                    const statusStyle = STATUS_COLORS[order.status] || {
                      ...DEFAULT_STATUS_STYLE,
                      label: order.status,
                    }

                    return (
                      <tr
                        key={order.id}
                        onClick={() => setSelectedOrder(order)}
                        className="border-t border-line hover:bg-tint cursor-pointer transition-colors"
                      >
                        <td className="px-3 py-4">
                          <span className="font-mono text-sm text-fg">{order.id.slice(-8).toUpperCase()}</span>
                        </td>
                        <td className="px-3 py-4">
                          <span className="font-mono text-sm text-fg">{order.email}</span>
                        </td>
                        <td className="px-3 py-4">
                          <span className="text-fg-2 text-sm">
                            {order.items.map((i) => `${i.quantity}x ${i.name}`).join(', ')}
                          </span>
                        </td>
                        <td className="px-3 py-4">
                          <span className="font-mono text-sm text-fg">{formatCurrency(order.amount)}</span>
                        </td>
                        <td className="px-3 py-4">
                          <StatusLabel style={statusStyle} />
                        </td>
                        <td className="px-3 py-4">
                          <span className="font-mono text-sm text-fg-2 whitespace-nowrap">
                            {formatDate(order.createdAt)}
                          </span>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Load More */}
        {hasMore && (
          <div className="pt-6 text-center">
            <button
              onClick={() => fetchOrders(nextCursor || undefined)}
              disabled={isLoading}
              className="btn btn-secondary btn-sm h-11"
            >
              {isLoading ? 'Loading...' : 'Load more orders'}
            </button>
          </div>
        )}

        {/* Order Detail Modal */}
        <AnimatePresence>
          {selectedOrder && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
              onClick={() => setSelectedOrder(null)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-surface-elevated border border-line rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Modal Header */}
                <div className="flex items-center justify-between gap-4 pl-5 pr-2 py-3 border-b border-line">
                  <div className="min-w-0">
                    <h3 className="text-lg font-normal text-fg">Order details</h3>
                    <p className="text-fg-2 text-sm font-mono">#{selectedOrder.id.slice(-8).toUpperCase()}</p>
                  </div>
                  <button
                    onClick={() => setSelectedOrder(null)}
                    aria-label="Close"
                    className="w-11 h-11 flex-shrink-0 inline-flex items-center justify-center rounded-full text-fg-2 hover:text-fg transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Modal Content */}
                <div className="p-5 space-y-6">
                  {/* Status */}
                  <div>
                    <div className="section-label mb-2">Status</div>
                    <StatusLabel
                      style={
                        STATUS_COLORS[selectedOrder.status] || {
                          ...DEFAULT_STATUS_STYLE,
                          label: selectedOrder.status,
                        }
                      }
                    />
                  </div>

                  {/* Customer */}
                  <div>
                    <div className="section-label mb-2">Customer</div>
                    <p className="text-fg font-mono text-sm break-all">{selectedOrder.email}</p>
                  </div>

                  {/* Shipping */}
                  {selectedOrder.shipping && (
                    <div>
                      <div className="section-label mb-2">Shipping address</div>
                      <div className="text-fg text-sm">
                        <p className="font-medium">{selectedOrder.shipping.name}</p>
                        <p className="text-fg-2 whitespace-pre-line">{selectedOrder.shipping.address}</p>
                      </div>
                    </div>
                  )}

                  {/* Items */}
                  <div>
                    <div className="section-label mb-2">Items</div>
                    <div className="border-b border-line">
                      {selectedOrder.items.map((item, idx) => (
                        <div key={idx} className="flex items-center justify-between gap-4 border-t border-line py-3">
                          <div className="min-w-0">
                            <span className="text-fg">{item.name}</span>
                            <span className="text-fg-2 font-mono text-sm ml-2">x{item.quantity}</span>
                          </div>
                          <span className="text-fg font-mono text-sm">{formatCurrency(item.price * item.quantity)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Total */}
                  <div className="flex items-center justify-between">
                    <span className="text-fg font-medium">Total</span>
                    <span className="text-xl text-fg font-mono">{formatCurrency(selectedOrder.amount)}</span>
                  </div>

                  {/* Date */}
                  <div className="text-fg-2 text-sm">
                    Ordered on <span className="font-mono">{formatDate(selectedOrder.createdAt)}</span>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col sm:flex-row gap-3 pt-2">
                    <a
                      href={`https://dashboard.stripe.com/payments/${selectedOrder.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-secondary flex-1"
                    >
                      View in Stripe
                    </a>
                    <a href={`mailto:${selectedOrder.email}`} className="btn btn-primary flex-1">
                      Email customer
                    </a>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  )
}
