import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { shippingSchema, type ShippingFormData } from '../../schemas/checkout'

interface ShippingFormProps {
  defaultValues: ShippingFormData
  onSubmit: (data: ShippingFormData) => void
  onBack: () => void
  isCalculatingTax?: boolean
}

export function ShippingForm({ defaultValues, onSubmit, onBack, isCalculatingTax }: ShippingFormProps) {
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
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl font-bold text-light">Shipping</h2>
        <button type="button" onClick={onBack} className="text-sm text-amber hover:underline">
          Edit email
        </button>
      </div>

      {/* Contact info summary */}
      <div className="p-4 bg-panel border border-border rounded-lg">
        <p className="text-sm text-muted mb-1">Contact</p>
        <p className="text-light">{defaultValues.email}</p>
      </div>

      {/* Name fields */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="firstName" className="block text-sm font-medium text-muted mb-2">
            First Name <span className="text-ifr">*</span>
          </label>
          <input
            {...register('firstName')}
            id="firstName"
            type="text"
            className="form-input"
            autoComplete="given-name"
          />
          {errors.firstName && <p className="mt-1 text-sm text-ifr">{errors.firstName.message}</p>}
        </div>
        <div>
          <label htmlFor="lastName" className="block text-sm font-medium text-muted mb-2">
            Last Name <span className="text-ifr">*</span>
          </label>
          <input
            {...register('lastName')}
            id="lastName"
            type="text"
            className="form-input"
            autoComplete="family-name"
          />
          {errors.lastName && <p className="mt-1 text-sm text-ifr">{errors.lastName.message}</p>}
        </div>
      </div>

      {/* Address */}
      <div>
        <label htmlFor="address" className="block text-sm font-medium text-muted mb-2">
          Address <span className="text-ifr">*</span>
        </label>
        <input
          {...register('address')}
          id="address"
          type="text"
          className="form-input"
          autoComplete="address-line1"
          placeholder="Street address"
        />
        {errors.address && <p className="mt-1 text-sm text-ifr">{errors.address.message}</p>}
      </div>

      {/* Apartment */}
      <div>
        <label htmlFor="apartment" className="block text-sm font-medium text-muted mb-2">
          Apartment, suite, etc. <span className="text-muted">(optional)</span>
        </label>
        <input
          {...register('apartment')}
          id="apartment"
          type="text"
          className="form-input"
          autoComplete="address-line2"
        />
      </div>

      {/* City/State/Zip */}
      <div className="grid grid-cols-6 gap-4">
        <div className="col-span-2">
          <label htmlFor="city" className="block text-sm font-medium text-muted mb-2">
            City <span className="text-ifr">*</span>
          </label>
          <input
            {...register('city')}
            id="city"
            type="text"
            className="form-input"
            autoComplete="address-level2"
          />
          {errors.city && <p className="mt-1 text-sm text-ifr">{errors.city.message}</p>}
        </div>
        <div className="col-span-2">
          <label htmlFor="state" className="block text-sm font-medium text-muted mb-2">
            State <span className="text-ifr">*</span>
          </label>
          <input
            {...register('state')}
            id="state"
            type="text"
            className="form-input"
            autoComplete="address-level1"
            placeholder="e.g. CA"
            maxLength={2}
          />
          {errors.state && <p className="mt-1 text-sm text-ifr">{errors.state.message}</p>}
        </div>
        <div className="col-span-2">
          <label htmlFor="zip" className="block text-sm font-medium text-muted mb-2">
            ZIP Code <span className="text-ifr">*</span>
          </label>
          <input
            {...register('zip')}
            id="zip"
            type="text"
            className="form-input"
            autoComplete="postal-code"
            maxLength={10}
          />
          {errors.zip && <p className="mt-1 text-sm text-ifr">{errors.zip.message}</p>}
        </div>
      </div>

      {/* Phone */}
      <div>
        <label htmlFor="phone" className="block text-sm font-medium text-muted mb-2">
          Phone <span className="text-muted">(optional, for delivery updates)</span>
        </label>
        <input
          {...register('phone')}
          id="phone"
          type="tel"
          className="form-input"
          autoComplete="tel"
        />
      </div>

      <button
        type="submit"
        disabled={isCalculatingTax}
        className="w-full btn-primary disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
      >
        {isCalculatingTax ? (
          <>
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            Calculating Tax...
          </>
        ) : (
          'Continue to Payment'
        )}
      </button>
    </form>
  )
}
