import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Nuroo',
  // Private, personalized invite links — never indexed or shared in search results.
  robots: { index: false, follow: false },
}

export default function JoinLayout({ children }: { children: React.ReactNode }) {
  return children
}
