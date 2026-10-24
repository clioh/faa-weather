import { APP_STORE_URL, PLAY_STORE_URL } from '../config/app'

export type Platform = 'ios' | 'android' | 'desktop'

/** iPhone, iPad (including iPadOS, which reports a Mac user agent) or Android; else desktop. */
export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'desktop'
  const ua = navigator.userAgent
  if (/android/i.test(ua)) return 'android'
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios'
  // iPadOS 13+ asks for desktop sites with a Macintosh user agent; only the iPad has touch.
  if (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1) return 'ios'
  return 'desktop'
}

interface Store {
  url: string | null
  label: string
  comingSoon: string
}

const STORES: Record<'ios' | 'android', Store> = {
  ios: {
    url: APP_STORE_URL,
    label: 'Download on the App Store',
    comingSoon: 'Coming soon to the App Store',
  },
  android: {
    url: PLAY_STORE_URL,
    label: 'Get it on Google Play',
    comingSoon: 'Coming soon to Google Play',
  },
}

/** Stores to offer on this platform: its own store on a phone, both on a desktop. */
export function storesFor(platform: Platform): Store[] {
  if (platform === 'ios') return [STORES.ios]
  if (platform === 'android') return [STORES.android]
  return [STORES.ios, STORES.android]
}

/** True when at least one store this platform would show has a listing. */
export function isAppAvailable(platform: Platform): boolean {
  return storesFor(platform).some((store) => store.url !== null)
}

interface StoreButtonsProps {
  platform: Platform
  /** Style the buttons as the page's main call to action. */
  primary?: boolean
}

/**
 * App Store / Google Play buttons for the visitor's platform. A store without a listing yet
 * shows a disabled "Coming soon" button. Rendered as a fragment so callers place the buttons
 * in their own button row.
 */
export function StoreButtons({ platform, primary = false }: StoreButtonsProps) {
  const style = primary ? 'btn-primary' : 'btn-secondary'
  return (
    <>
      {storesFor(platform).map((store) =>
        store.url ? (
          <a
            key={store.label}
            href={store.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`btn ${style} w-full sm:w-auto`}
          >
            {store.label}
          </a>
        ) : (
          <span
            key={store.label}
            aria-disabled="true"
            className="btn btn-secondary w-full sm:w-auto select-none"
          >
            {store.comingSoon}
          </span>
        )
      )}
    </>
  )
}
