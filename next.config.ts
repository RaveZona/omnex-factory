import type { NextConfig } from 'next'

// Same hardening as the proven OMNEX platform config.
const SECURITY_HEADERS = [
  { key: 'X-DNS-Prefetch-Control',    value: 'on' },
  { key: 'X-Frame-Options',           value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options',    value: 'nosniff' },
  { key: 'Referrer-Policy',           value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy',        value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
]

const nextConfig: NextConfig = {
  typedRoutes: true,

  turbopack: {
    resolveExtensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
  },

  images: {
    formats:         ['image/avif', 'image/webp'],
    deviceSizes:     [640, 750, 828, 1080, 1200, 1920],
    imageSizes:      [16, 32, 48, 64, 96, 128, 256],
    minimumCacheTTL: 60 * 60 * 24 * 30,
    remotePatterns:  [
      // Supabase Storage holds uploaded products + generated assets.
      { protocol: 'https', hostname: '*.supabase.co' },
      // Generation providers return images on their own CDNs.
      { protocol: 'https', hostname: '*.fal.media' },
      { protocol: 'https', hostname: 'replicate.delivery' },
      { protocol: 'https', hostname: '*.replicate.delivery' },
      { protocol: 'https', hostname: 'oaidalleapiprodscus.blob.core.windows.net' },
    ],
  },

  async headers() {
    return [
      { source: '/(.*)',     headers: SECURITY_HEADERS },
      { source: '/api/(.*)', headers: [{ key: 'Cache-Control', value: 'no-store' }] },
    ]
  },

  async redirects() {
    return [
      { source: '/app', destination: '/dashboard', permanent: false },
    ]
  },

  compress:        true,
  poweredByHeader: false,
  reactStrictMode: true,
  typescript:      { ignoreBuildErrors: false },
}

export default nextConfig
