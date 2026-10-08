import type { Meta, StoryObj } from '@storybook/react'
import { EmailForm } from './EmailForm'

const meta: Meta<typeof EmailForm> = {
  title: 'Checkout/EmailForm',
  component: EmailForm,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="w-[400px] p-6 bg-void">
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    defaultEmail: '',
    onSubmit: (data) => console.log('Form submitted:', data),
  },
}

export const WithEmail: Story = {
  args: {
    defaultEmail: 'pilot@example.com',
    onSubmit: (data) => console.log('Form submitted:', data),
  },
}
