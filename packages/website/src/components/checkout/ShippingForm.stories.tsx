import type { Meta, StoryObj } from '@storybook/react'
import { ShippingForm } from './ShippingForm'
import { initialShippingData } from '../../schemas/checkout'

const meta: Meta<typeof ShippingForm> = {
  title: 'Checkout/ShippingForm',
  component: ShippingForm,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[500px] p-6 bg-void">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    defaultValues: {
      ...initialShippingData,
      email: 'pilot@example.com',
    },
    onSubmit: (data) => console.log('Form submitted:', data),
    onBack: () => console.log('Back clicked'),
    isCalculatingTax: false,
  },
}

export const WithData: Story = {
  args: {
    defaultValues: {
      email: 'pilot@example.com',
      firstName: 'John',
      lastName: 'Smith',
      address: '123 Aviation Way',
      apartment: 'Suite 100',
      city: 'San Francisco',
      state: 'CA',
      zip: '94102',
      country: 'US',
      phone: '(555) 123-4567',
    },
    onSubmit: (data) => console.log('Form submitted:', data),
    onBack: () => console.log('Back clicked'),
    isCalculatingTax: false,
  },
}

export const CalculatingTax: Story = {
  args: {
    defaultValues: {
      ...initialShippingData,
      email: 'pilot@example.com',
    },
    onSubmit: (data) => console.log('Form submitted:', data),
    onBack: () => console.log('Back clicked'),
    isCalculatingTax: true,
  },
}
