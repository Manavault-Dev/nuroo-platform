'use client'

import { useEffect } from 'react'
import { addClientReplayWhenIdle, initClientSentry } from '@/lib/sentryClient'

/**
 * Site-wide client-side Sentry init. Previously this only ran inside
 * (b2b)/layout.tsx, so the marketplace/landing pages — where most real
 * end-user traffic actually is — had no proactive error/breadcrumb
 * tracking, only the crash-only fallback in global-error.tsx. This mounts
 * once at the root locale layout so every page gets the same coverage;
 * (b2b)/layout.tsx still separately attaches signed-in user/org context on
 * top of this, which only makes sense there.
 */
export function SentryClientProvider() {
  useEffect(() => {
    void initClientSentry()
    return addClientReplayWhenIdle()
  }, [])

  return null
}
