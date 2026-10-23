import { create } from 'zustand'

interface WaitlistState {
  email: string
  isSubmitted: boolean
  isSubmitting: boolean
  error: string | null
  setEmail: (email: string) => void
  submit: () => Promise<void>
}

export const useWaitlist = create<WaitlistState>((set, get) => ({
  email: '',
  isSubmitted: false,
  isSubmitting: false,
  error: null,

  setEmail: (email) => set({ email, error: null }),

  submit: async () => {
    const email = get().email.trim()

    if (!email || !email.includes('@')) {
      set({ error: 'Enter a valid email address' })
      return
    }

    set({ isSubmitting: true, error: null })

    let response: Response
    try {
      response = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
    } catch {
      set({
        error: "Couldn't reach SkyGlass. Check your connection and try again.",
        isSubmitting: false,
      })
      return
    }

    // `vite` alone doesn't serve /api (that needs `vercel dev`): pretend it worked in development.
    if (import.meta.env.DEV && response.status === 404) {
      console.warn('[SkyGlass] /api/waitlist is not running; run `vercel dev` to test it.')
      set({ isSubmitted: true, isSubmitting: false })
      return
    }

    const data = (await response.json().catch(() => null)) as { error?: string } | null
    if (!response.ok) {
      set({
        error: data?.error || 'Something went wrong. Please try again.',
        isSubmitting: false,
      })
      return
    }

    set({ isSubmitted: true, isSubmitting: false })
  },
}))
