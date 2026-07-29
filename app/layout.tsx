import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'OMNEX Factory — AI business modules on one platform',
  description:
    'One login, one balance, many AI business tools. Start with AI Ad Studio: upload your product, get premium advertising visuals.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
