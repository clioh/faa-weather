import { z } from 'zod'

export const shippingSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Invalid email address'),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  address: z.string().min(1, 'Address is required'),
  apartment: z.string().optional(),
  city: z.string().min(1, 'City is required'),
  state: z.string().min(1, 'State is required'),
  zip: z.string().min(5, 'ZIP code is required'),
  country: z.string().min(1, 'Country is required'),
  phone: z.string().optional(),
})

export type ShippingFormData = z.infer<typeof shippingSchema>

export const emailSchema = shippingSchema.pick({ email: true })

export type EmailFormData = z.infer<typeof emailSchema>

export const initialShippingData: ShippingFormData = {
  email: '',
  firstName: '',
  lastName: '',
  address: '',
  apartment: '',
  city: '',
  state: '',
  zip: '',
  country: 'US',
  phone: '',
}
