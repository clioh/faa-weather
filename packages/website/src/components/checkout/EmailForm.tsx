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
      <h2 className="font-display text-2xl font-bold text-light">Contact Information</h2>

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-muted mb-2">
          Email <span className="text-ifr">*</span>
        </label>
        <input
          {...register('email')}
          id="email"
          type="email"
          className="form-input"
          autoComplete="email"
          placeholder="your@email.com"
        />
        {errors.email && <p className="mt-1 text-sm text-ifr">{errors.email.message}</p>}
      </div>

      <p className="text-xs text-muted">
        We&apos;ll send your receipt and shipping updates to this email.
      </p>

      <button type="submit" className="w-full btn-primary">
        Continue to Shipping
      </button>
    </form>
  )
}
