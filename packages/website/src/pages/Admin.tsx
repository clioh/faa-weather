import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Link } from 'react-router-dom'

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

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  succeeded: { bg: 'bg-vfr/10', text: 'text-vfr', label: 'Paid' },
  processing: { bg: 'bg-amber/10', text: 'text-amber', label: 'Processing' },
  requires_payment_method: { bg: 'bg-muted/10', text: 'text-muted', label: 'Pending' },
  requires_confirmation: { bg: 'bg-amber/10', text: 'text-amber', label: 'Confirming' },
  requires_action: { bg: 'bg-amber/10', text: 'text-amber', label: 'Action Required' },
  canceled: { bg: 'bg-ifr/10', text: 'text-ifr', label: 'Canceled' },
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
      <div className="min-h-screen bg-void flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-sm"
        >
          <div className="text-center mb-8">
            <Link to="/" className="inline-block">
              <span className="text-2xl font-bold tracking-wider">
                <span className="text-light">Sky</span>
                <span className="text-amber">Glass</span>
              </span>
            </Link>
            <p className="text-muted mt-2">Admin Dashboard</p>
          </div>

          <form onSubmit={handleLogin} className="bg-panel border border-border rounded-lg p-6">
            <div className="mb-4">
              <label className="block text-amber text-xs uppercase tracking-wider mb-2">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-void border border-border rounded-lg px-4 py-3 text-light focus:outline-none focus:border-amber/50 transition-colors"
                placeholder="Enter admin password"
                autoFocus
              />
            </div>

            {authError && (
              <p className="text-ifr text-sm mb-4">{authError}</p>
            )}

            <button
              type="submit"
              disabled={isLoading || !password}
              className="w-full bg-amber/10 border border-amber/50 text-amber py-3 rounded-lg font-medium uppercase tracking-wider text-sm hover:bg-amber/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Authenticating...' : 'Login'}
            </button>
          </form>

          <p className="text-center text-muted text-sm mt-4">
            <Link to="/" className="hover:text-light transition-colors">
              &larr; Back to site
            </Link>
          </p>
        </motion.div>
      </div>
    )
  }

  // Dashboard
  return (
    <div className="min-h-screen bg-void">
      {/* Header */}
      <header className="bg-panel border-b border-border sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <Link to="/" className="text-xl font-bold tracking-wider">
                <span className="text-light">Sky</span>
                <span className="text-amber">Glass</span>
              </Link>
              <span className="text-muted text-sm">/</span>
              <span className="text-light text-sm">Admin</span>
            </div>

            <button
              onClick={handleLogout}
              className="text-muted hover:text-light text-sm transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats */}
        {stats && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8"
          >
            <div className="bg-panel border border-border rounded-lg p-6">
              <div className="text-muted text-xs uppercase tracking-wider mb-1">Total Orders</div>
              <div className="text-3xl font-bold text-light font-mono">{stats.totalOrders}</div>
            </div>
            <div className="bg-panel border border-border rounded-lg p-6">
              <div className="text-muted text-xs uppercase tracking-wider mb-1">Revenue</div>
              <div className="text-3xl font-bold text-vfr font-mono">
                {formatCurrency(stats.totalRevenue)}
              </div>
            </div>
            <div className="bg-panel border border-border rounded-lg p-6">
              <div className="text-muted text-xs uppercase tracking-wider mb-1">Pending</div>
              <div className="text-3xl font-bold text-amber font-mono">{stats.pendingOrders}</div>
            </div>
          </motion.div>
        )}

        {/* Filters */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-light">Orders</h2>
          <div className="flex items-center gap-2">
            <span className="text-muted text-sm">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-instrument border border-border rounded-lg px-3 py-2 text-light text-sm focus:outline-none focus:border-amber/50"
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
        <div className="bg-panel border border-border rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-amber text-xs uppercase tracking-wider px-4 py-3">
                    Order
                  </th>
                  <th className="text-left text-amber text-xs uppercase tracking-wider px-4 py-3">
                    Customer
                  </th>
                  <th className="text-left text-amber text-xs uppercase tracking-wider px-4 py-3">
                    Items
                  </th>
                  <th className="text-left text-amber text-xs uppercase tracking-wider px-4 py-3">
                    Amount
                  </th>
                  <th className="text-left text-amber text-xs uppercase tracking-wider px-4 py-3">
                    Status
                  </th>
                  <th className="text-left text-amber text-xs uppercase tracking-wider px-4 py-3">
                    Date
                  </th>
                </tr>
              </thead>
              <tbody>
                {isLoading && orders.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-muted">
                      Loading orders...
                    </td>
                  </tr>
                ) : orders.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-muted">
                      No orders found
                    </td>
                  </tr>
                ) : (
                  orders.map((order) => {
                    const statusStyle = STATUS_COLORS[order.status] || {
                      bg: 'bg-muted/10',
                      text: 'text-muted',
                      label: order.status,
                    }

                    return (
                      <tr
                        key={order.id}
                        onClick={() => setSelectedOrder(order)}
                        className="border-b border-border/50 hover:bg-instrument/50 cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-4">
                          <span className="font-mono text-sm text-light">
                            {order.id.slice(-8).toUpperCase()}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <span className="text-light text-sm">{order.email}</span>
                        </td>
                        <td className="px-4 py-4">
                          <span className="text-muted text-sm">
                            {order.items.map((i) => `${i.quantity}x ${i.name}`).join(', ')}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <span className="font-mono text-light">{formatCurrency(order.amount)}</span>
                        </td>
                        <td className="px-4 py-4">
                          <span
                            className={`inline-block px-2 py-1 rounded text-xs uppercase tracking-wider ${statusStyle.bg} ${statusStyle.text}`}
                          >
                            {statusStyle.label}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <span className="text-muted text-sm">{formatDate(order.createdAt)}</span>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Load More */}
          {hasMore && (
            <div className="p-4 border-t border-border text-center">
              <button
                onClick={() => fetchOrders(nextCursor || undefined)}
                disabled={isLoading}
                className="text-amber hover:text-amber/80 text-sm transition-colors disabled:opacity-50"
              >
                {isLoading ? 'Loading...' : 'Load more orders'}
              </button>
            </div>
          )}
        </div>

        {/* Order Detail Modal */}
        <AnimatePresence>
          {selectedOrder && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-void/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
              onClick={() => setSelectedOrder(null)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-panel border border-border rounded-lg w-full max-w-lg max-h-[80vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Modal Header */}
                <div className="flex items-center justify-between p-4 border-b border-border">
                  <div>
                    <h3 className="text-lg font-semibold text-light">Order Details</h3>
                    <p className="text-muted text-sm font-mono">
                      #{selectedOrder.id.slice(-8).toUpperCase()}
                    </p>
                  </div>
                  <button
                    onClick={() => setSelectedOrder(null)}
                    className="text-muted hover:text-light transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>

                {/* Modal Content */}
                <div className="p-4 space-y-6">
                  {/* Status */}
                  <div>
                    <div className="text-amber text-xs uppercase tracking-wider mb-2">Status</div>
                    {(() => {
                      const statusStyle = STATUS_COLORS[selectedOrder.status] || {
                        bg: 'bg-muted/10',
                        text: 'text-muted',
                        label: selectedOrder.status,
                      }
                      return (
                        <span
                          className={`inline-block px-3 py-1 rounded text-sm uppercase tracking-wider ${statusStyle.bg} ${statusStyle.text}`}
                        >
                          {statusStyle.label}
                        </span>
                      )
                    })()}
                  </div>

                  {/* Customer */}
                  <div>
                    <div className="text-amber text-xs uppercase tracking-wider mb-2">Customer</div>
                    <p className="text-light">{selectedOrder.email}</p>
                  </div>

                  {/* Shipping */}
                  {selectedOrder.shipping && (
                    <div>
                      <div className="text-amber text-xs uppercase tracking-wider mb-2">
                        Shipping Address
                      </div>
                      <div className="text-light text-sm">
                        <p className="font-medium">{selectedOrder.shipping.name}</p>
                        <p className="text-muted whitespace-pre-line">
                          {selectedOrder.shipping.address}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Items */}
                  <div>
                    <div className="text-amber text-xs uppercase tracking-wider mb-2">Items</div>
                    <div className="space-y-2">
                      {selectedOrder.items.map((item, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between bg-instrument rounded-lg px-3 py-2"
                        >
                          <div>
                            <span className="text-light">{item.name}</span>
                            <span className="text-muted ml-2">x{item.quantity}</span>
                          </div>
                          <span className="text-light font-mono">
                            {formatCurrency(item.price * item.quantity)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Total */}
                  <div className="border-t border-border pt-4">
                    <div className="flex items-center justify-between">
                      <span className="text-light font-medium">Total</span>
                      <span className="text-xl font-bold text-amber font-mono">
                        {formatCurrency(selectedOrder.amount)}
                      </span>
                    </div>
                  </div>

                  {/* Date */}
                  <div className="text-muted text-sm">
                    Ordered on {formatDate(selectedOrder.createdAt)}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-3 pt-2">
                    <a
                      href={`https://dashboard.stripe.com/payments/${selectedOrder.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 text-center bg-instrument border border-border text-light py-2 rounded-lg text-sm hover:bg-border transition-colors"
                    >
                      View in Stripe
                    </a>
                    <a
                      href={`mailto:${selectedOrder.email}`}
                      className="flex-1 text-center bg-amber/10 border border-amber/50 text-amber py-2 rounded-lg text-sm hover:bg-amber/20 transition-colors"
                    >
                      Email Customer
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
