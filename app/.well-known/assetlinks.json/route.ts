import { NextResponse } from 'next/server'

// Android App Links — verified by Android at install time via this file's
// SHA256 fingerprint matching the app's release signing certificate.
//
// ⚠️ TODO before this works: replace the placeholder fingerprint below with
// the real one. Get it with:
//   cd nuroo-app && eas credentials -p android --profile production
// (or from Google Play Console → Setup → App signing → SHA-256 certificate
// fingerprint, if Play App Signing is enabled). Until this is a real value,
// Android will silently fall back to opening links in the browser instead
// of the app.
const ASSET_LINKS = [
  {
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: 'nuroo.app',
      sha256_cert_fingerprints: ['REPLACE_WITH_REAL_SHA256_FINGERPRINT'],
    },
  },
]

export function GET() {
  return NextResponse.json(ASSET_LINKS, {
    headers: { 'Content-Type': 'application/json' },
  })
}
