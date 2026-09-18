import { NextResponse } from 'next/server'

// Apple Universal Links — verified by iOS at install/first-launch time.
// Must be served at exactly this path, over HTTPS, with no redirects.
// appID = "<Apple Team ID>.<bundle identifier>" (see nuroo-app/eas.json
// submit.production.ios.appleTeamId, app.config.js ios.bundleIdentifier).
const AASA = {
  applinks: {
    apps: [],
    details: [
      {
        appID: 'R2T5338ATS.nuroo.app',
        paths: ['/*/marketplace/*'],
      },
    ],
  },
}

export function GET() {
  return NextResponse.json(AASA, {
    headers: { 'Content-Type': 'application/json' },
  })
}
