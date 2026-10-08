import type { Preview } from '@storybook/react'
import '../src/index.css'

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: 'void',
      values: [
        { name: 'void', value: '#0a0a0f' },
        { name: 'panel', value: '#12121a' },
        { name: 'light', value: '#ffffff' },
      ],
    },
  },
}

export default preview
