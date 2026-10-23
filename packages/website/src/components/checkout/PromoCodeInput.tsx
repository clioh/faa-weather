import { useState } from 'react'

interface PromoCodeInputProps {
  onApply: (code: string) => Promise<void>
  isValidating: boolean
  error: string | null
}

export function PromoCodeInput({ onApply, isValidating, error }: PromoCodeInputProps) {
  const [code, setCode] = useState('')
  const [isExpanded, setIsExpanded] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!code.trim()) return
    await onApply(code.trim())
    if (!error) {
      setCode('')
    }
  }

  if (!isExpanded) {
    return (
      <button
        onClick={() => setIsExpanded(true)}
        className="link text-sm min-h-11 inline-flex items-center gap-2"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
          />
        </svg>
        Have a promo code?
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="Enter code"
          aria-label="Promo code"
          aria-invalid={error ? 'true' : undefined}
          className="field-input flex-1 min-w-0 font-mono uppercase disabled:opacity-50"
          disabled={isValidating}
        />
        <button
          type="submit"
          disabled={isValidating || !code.trim()}
          className="btn btn-secondary btn-sm h-[52px] rounded-[26px] flex-shrink-0"
        >
          {isValidating ? (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-label="Checking code">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          ) : (
            'Apply'
          )}
        </button>
      </div>
      {error && <p role="alert" className="field-error">{error}</p>}
    </form>
  )
}
