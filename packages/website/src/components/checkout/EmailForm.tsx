import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { emailSchema, type EmailFormData } from '../../schemas/checkout'

interface EmailFormProps {
  defaultEmail: string
  onSubmit: (data: EmailFormData) => void
}

export function EmailForm({ defaultEmail, onSubmit }: EmailFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<EmailFormData>({
    resolver: zodResolver(emailSchema),
    defaultValues: { email: defaultEmail },
  })

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <h2 className="text-[28px] font-light tracking-[-0.01em] text-fg">Contact information</h2>

      <div>
        <label htmlFor="email" className="field-label">
          Email{' '}
          <span className="text-fg-3" aria-hidden="true">
            *
          </span>
        </label>
        <input
          {...register('email')}
          id="email"
          type="email"
          className="field-input"
          autoComplete="email"
          aria-invalid={errors.email ? 'true' : undefined}
          placeholder="your@email.com"
        />
        {errors.email && <p className="field-error">{errors.email.message}</p>}
      </div>

      <p className="text-xs text-fg-3">
        We&apos;ll send your receipt and shipping updates to this email.
      </p>

      <button type="submit" className="btn btn-primary w-full">
        Continue to shipping
      </button>
    </form>
  )
}
