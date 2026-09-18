const withNextIntl = require('next-intl/plugin')('./i18n/request.ts')

/** @type {import('next').NextConfig} */
const nextConfig = {
  compress: true,
  poweredByHeader: false,
  env: {
    // Vercel injects VERCEL_GIT_COMMIT_SHA automatically at build time — no
    // secret to configure. This makes Sentry release tracking on the web
    // actually work (it was previously reading an env var nothing ever set).
    NEXT_PUBLIC_APP_VERSION: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.npm_package_version,
  },
  transpilePackages: ['next-intl'],
  experimental: {
    // Tree-shake barrel imports — each added package can save 50-200 KB
    optimizePackageImports: ['lucide-react', 'next-intl'],
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
      {
        protocol: 'https',
        hostname: 'storage.googleapis.com',
      },
      {
        protocol: 'https',
        hostname: 'firebasestorage.googleapis.com',
      },
      {
        protocol: 'https',
        hostname: 'static.wixstatic.com',
      },
      {
        protocol: 'https',
        hostname: 'media.licdn.com',
      },
      // Google-cached thumbnails (encrypted-tbn0..N.gstatic.com)
      {
        protocol: 'https',
        hostname: '**.gstatic.com',
      },
      // Google user-content (profile photos, Drive, etc.)
      {
        protocol: 'https',
        hostname: '**.googleusercontent.com',
      },
    ],
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 60 * 60 * 24 * 30, // 30 days
    deviceSizes: [390, 640, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256],
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
    }
    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      {
        module:
          /node_modules\/(@prisma\/instrumentation|@fastify\/otel|@opentelemetry\/instrumentation|require-in-the-middle)/,
        message: /Critical dependency/,
      },
    ]

    return config
  },
  async redirects() {
    return [
      {
        source: '/:locale/auth/login',
        destination: '/:locale/b2b/login',
        permanent: true,
      },
      {
        source: '/auth/login',
        destination: '/en/b2b/login',
        permanent: true,
      },
    ]
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
        ],
      },
      {
        source: '/:all*(svg|jpg|png|webp|avif)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ]
  },
}

module.exports = withNextIntl(nextConfig)

// Injected content via Sentry wizard below

const { withSentryConfig } = require('@sentry/nextjs/config')

module.exports = withSentryConfig(module.exports, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: 'nuroo',
  project: 'javascript-nextjs',

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: false,

  // Hide source maps from the client bundle — reduces chunk size significantly
  hideSourceMaps: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: '/monitoring',

  webpack: {
    disableSentryConfig: process.env.NODE_ENV === 'development',
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shake Sentry logger statements — removes debug code from bundle
    disableLogger: true,
  },
})
