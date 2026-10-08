import { create } from 'zustand'

interface WaitlistState {
  email: string
  airport: string
  position: number | null
  isSubmitted: boolean
  isSubmitting: boolean
  error: string | null
  setEmail: (email: string) => void
  setAirport: (airport: string) => void
  submit: () => Promise<void>
  reset: () => void
}

export const useWaitlist = create<WaitlistState>((set, get) => ({
  email: '',
  airport: '',
  position: null,
  isSubmitted: false,
  isSubmitting: false,
  error: null,

  setEmail: (email) => set({ email, error: null }),
  setAirport: (airport) => set({ airport: airport.toUpperCase() }),

  submit: async () => {
    const { email, airport } = get()

    if (!email || !email.includes('@')) {
      set({ error: 'Please enter a valid email address' })
      return
    }

    set({ isSubmitting: true, error: null })

    try {
      const response = await fetch('/api/waitlist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, airport: airport || undefined }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to join waitlist')
      }

      set({
        isSubmitted: true,
        isSubmitting: false,
        position: data.position || null,
      })
    } catch (error) {
      // Fallback to localStorage for local development without API
      if (import.meta.env.DEV) {
        const waitlist = JSON.parse(localStorage.getItem('skyglass-waitlist') || '[]')
        waitlist.push({ email, airport, timestamp: Date.now() })
        localStorage.setItem('skyglass-waitlist', JSON.stringify(waitlist))
        set({
          isSubmitted: true,
          isSubmitting: false,
          position: waitlist.length,
        })
        return
      }

      set({
        error: error instanceof Error ? error.message : 'Something went wrong',
        isSubmitting: false,
      })
    }
  },

  reset: () =>
    set({
      email: '',
      airport: '',
      position: null,
      isSubmitted: false,
      isSubmitting: false,
      error: null,
    }),
}))
