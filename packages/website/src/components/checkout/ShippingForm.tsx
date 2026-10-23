import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { shippingSchema, type ShippingFormData } from '../../schemas/checkout'

interface ShippingFormProps {
  defaultValues: ShippingFormData
  onSubmit: (data: ShippingFormData) => void
  onBack: () => void
  isCalculatingTax?: boolean
}

export function ShippingForm({
  defaultValues,
  onSubmit,
  onBack,
  isCalculatingTax,
}: ShippingFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ShippingFormData>({
    resolver: zodResolver(shippingSchema),
    defaultValues,
  })

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-[28px] font-light tracking-[-0.01em] text-fg">Shipping</h2>
        <button
          type="button"
          onClick={onBack}
          className="link min-h-11 inline-flex items-center text-sm"
        >
          Edit email
        </button>
      </div>

      {/* Contact info summary */}
      <div className="rounded-2xl border border-line bg-tint p-4">
        <p className="text-[13px] text-fg-3 mb-1">Contact</p>
        <p className="text-fg break-all">{defaultValues.email}</p>
      </div>

      {/* Name fields */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="firstName" className="field-label">
            First name{' '}
            <span className="text-fg-3" aria-hidden="true">
              *
            </span>
          </label>
          <input
            {...register('firstName')}
            id="firstName"
            type="text"
            className="field-input"
            aria-invalid={errors.firstName ? 'true' : undefined}
            autoComplete="given-name"
          />
          {errors.firstName && <p className="field-error">{errors.firstName.message}</p>}
        </div>
        <div>
          <label htmlFor="lastName" className="field-label">
            Last name{' '}
            <span className="text-fg-3" aria-hidden="true">
              *
            </span>
          </label>
          <input
            {...register('lastName')}
            id="lastName"
            type="text"
            className="field-input"
            aria-invalid={errors.lastName ? 'true' : undefined}
            autoComplete="family-name"
          />
          {errors.lastName && <p className="field-error">{errors.lastName.message}</p>}
        </div>
      </div>

      {/* Address */}
      <div>
        <label htmlFor="address" className="field-label">
          Address{' '}
          <span className="text-fg-3" aria-hidden="true">
            *
          </span>
        </label>
        <input
          {...register('address')}
          id="address"
          type="text"
          className="field-input"
          aria-invalid={errors.address ? 'true' : undefined}
          autoComplete="address-line1"
          placeholder="Street address"
        />
        {errors.address && <p className="field-error">{errors.address.message}</p>}
      </div>

      {/* Apartment */}
      <div>
        <label htmlFor="apartment" className="field-label">
          Apartment, suite, etc. <span className="text-fg-3">(optional)</span>
        </label>
        <input
          {...register('apartment')}
          id="apartment"
          type="text"
          className="field-input"
          autoComplete="address-line2"
        />
      </div>

      {/* City/State/Zip */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="col-span-2 sm:col-span-1">
          <label htmlFor="city" className="field-label">
            City{' '}
            <span className="text-fg-3" aria-hidden="true">
              *
            </span>
          </label>
          <input
            {...register('city')}
            id="city"
            type="text"
            className="field-input"
            aria-invalid={errors.city ? 'true' : undefined}
            autoComplete="address-level2"
          />
          {errors.city && <p className="field-error">{errors.city.message}</p>}
        </div>
        <div>
          <label htmlFor="state" className="field-label">
            State{' '}
            <span className="text-fg-3" aria-hidden="true">
              *
            </span>
          </label>
          <input
            {...register('state')}
            id="state"
            type="text"
            className="field-input uppercase"
            aria-invalid={errors.state ? 'true' : undefined}
            autoComplete="address-level1"
            placeholder="e.g. CA"
            maxLength={2}
          />
          {errors.state && <p className="field-error">{errors.state.message}</p>}
        </div>
        <div>
          <label htmlFor="zip" className="field-label">
            ZIP code{' '}
            <span className="text-fg-3" aria-hidden="true">
              *
            </span>
          </label>
          <input
            {...register('zip')}
            id="zip"
            type="text"
            className="field-input font-mono"
            aria-invalid={errors.zip ? 'true' : undefined}
            autoComplete="postal-code"
            maxLength={10}
          />
          {errors.zip && <p className="field-error">{errors.zip.message}</p>}
        </div>
      </div>

      {/* Phone */}
      <div>
        <label htmlFor="phone" className="field-label">
          Phone <span className="text-fg-3">(optional, for delivery updates)</span>
        </label>
        <input
          {...register('phone')}
          id="phone"
          type="tel"
          className="field-input font-mono"
          autoComplete="tel"
        />
      </div>

      <button type="submit" disabled={isCalculatingTax} className="btn btn-primary w-full">
        {isCalculatingTax ? (
          <>
            <svg
              className="w-5 h-5 animate-spin"
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            Calculating tax...
          </>
        ) : (
          'Continue to payment'
        )}
      </button>
    </form>
  )
}
