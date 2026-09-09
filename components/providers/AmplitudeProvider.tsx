'use client'

import { useEffect } from 'react'

const AMPLITUDE_API_KEY = process.env.NEXT_PUBLIC_AMPLITUDE_API_KEY

let amplitudeInitialized = false

declare global {
  interface Window {
    __nurooAmplitudeInitialized?: boolean
  }
}

function shouldLoadAmplitude() {
  if (!AMPLITUDE_API_KEY) return false
  if (process.env.NODE_ENV !== 'production') return false
  if (typeof window === 'undefined') return false

  const host = window.location.hostname
  if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') return false
  if (navigator.userAgent.includes('Lighthouse')) return false

  return true
}

function runAfterStartup(callback: () => void) {
  const timeoutId = window.setTimeout(() => {
    const idle = window.requestIdleCallback

    if (idle) {
      idle(callback, { timeout: 3000 })
      return
    }

    callback()
  }, 6000)

  return () => window.clearTimeout(timeoutId)
}

export function AmplitudeProvider() {
  useEffect(() => {
    if (!shouldLoadAmplitude()) return
    if (amplitudeInitialized || window.__nurooAmplitudeInitialized) return

    const apiKey = AMPLITUDE_API_KEY!
    amplitudeInitialized = true
    window.__nurooAmplitudeInitialized = true

    return runAfterStartup(() => {
      void import('@amplitude/unified').then((amplitude) =>
        amplitude
          .initAll(apiKey, {
            analytics: {
              autocapture: true,
            },
            sessionReplay: {
              sampleRate: 0.01,
            },
          })
          .then(() => {
            amplitude.track('nuroo_app_loaded', {
              path: window.location.pathname,
            })
          })
      )
    })
  }, [])

  return null
}
