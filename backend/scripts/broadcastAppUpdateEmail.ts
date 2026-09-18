/**
 * Broadcast an "app update available" email to every registered Nuroo user,
 * with App Store / Google Play links.
 *
 * SAFETY: dry run by default — it only counts recipients and prints a
 * preview. Nothing is sent until you pass --send explicitly.
 *
 * Usage:
 *   npm run broadcast-app-update                                    # dry run, all users
 *   npm run broadcast-app-update -- --email=you@example.com          # dry run, ONE address only
 *   npm run broadcast-app-update -- --send --email=you@example.com   # real send, ONE address only
 *   npm run broadcast-app-update -- --send --limit=25                # real send, first 25 users
 *   npm run broadcast-app-update -- --send                           # real send, all users
 *   npm run broadcast-app-update -- --send --resume=scripts/output/app-update-broadcast-<ts>.jsonl
 *                                                                     # skip emails already logged as sent
 *
 * --email overrides the recipient list entirely — use it to send yourself
 * a real test copy before ever running --send without --email/--limit.
 *
 * Sends via Resend's batch API, 100 recipients per call, ALWAYS one
 * recipient per message (never multiple real users in the same `to` —
 * that would leak everyone's address to everyone else in the batch), with
 * permissive validation so one bad address in a batch can't take down the
 * other 99. Obviously fake/placeholder addresses (e.g. leftover test data
 * on @example.com) are filtered out before sending. Every attempt (sent or
 * failed) is appended to a .jsonl log file so a crashed or quota-limited
 * run can be resumed later without double-emailing anyone. If Resend
 * reports the daily sending quota is exhausted, the script stops
 * immediately instead of burning through the remaining batches.
 */
import { Resend } from 'resend'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { initializeFirebaseAdmin, getAuth } from '../src/infrastructure/database/firebase.js'
import { appUpdateTemplate } from '../src/modules/email/email.templates.js'

const IOS_URL = 'https://apps.apple.com/app/id6753772410'
const ANDROID_URL = 'https://play.google.com/store/apps/details?id=nuroo.app'

const BATCH_SIZE = 100
const DELAY_BETWEEN_BATCHES_MS = 600

// Domains used by test fixtures / seed scripts (scripts/seedTestParent.ts etc.)
// — never real recipients, and Resend rejects @example.com outright.
const FAKE_EMAIL_DOMAINS = new Set(['example.com', 'example.org', 'example.net', 'test.com'])
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface Recipient {
  email: string
  name: string
}

function parseArgs() {
  const args = process.argv.slice(2)
  const send = args.includes('--send')
  const limitArg = args.find((a) => a.startsWith('--limit='))
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : undefined
  const resumeArg = args.find((a) => a.startsWith('--resume='))
  const resumeFile = resumeArg ? resumeArg.split('=')[1] : undefined
  const emailArg = args.find((a) => a.startsWith('--email='))
  const onlyEmail = emailArg ? emailArg.split('=')[1].trim().toLowerCase() : undefined
  return { send, limit, resumeFile, onlyEmail }
}

function isRealEmail(email: string): boolean {
  if (!EMAIL_RE.test(email)) return false
  const domain = email.split('@')[1]
  return !FAKE_EMAIL_DOMAINS.has(domain)
}

async function collectRecipients(): Promise<Recipient[]> {
  const auth = getAuth()
  const recipients: Recipient[] = []
  const seen = new Set<string>()
  let skippedFake = 0

  let pageToken: string | undefined
  do {
    const page = await auth.listUsers(1000, pageToken)
    for (const user of page.users) {
      const email = user.email?.trim().toLowerCase()
      if (!email || seen.has(email) || user.disabled) continue
      if (!isRealEmail(email)) {
        skippedFake++
        continue
      }
      seen.add(email)
      recipients.push({ email, name: user.displayName?.trim() ?? '' })
    }
    pageToken = page.pageToken
  } while (pageToken)

  if (skippedFake > 0) {
    console.log(`🧹 Filtered out ${skippedFake} test/placeholder address(es) (e.g. @example.com)`)
  }
  return recipients
}

function loadAlreadySent(resumeFile: string): Set<string> {
  const sent = new Set<string>()
  if (!existsSync(resumeFile)) {
    console.warn(`⚠️  --resume file not found, ignoring: ${resumeFile}`)
    return sent
  }
  const lines = readFileSync(resumeFile, 'utf8').split('\n').filter(Boolean)
  for (const line of lines) {
    try {
      const entry = JSON.parse(line)
      if (entry.status === 'sent') sent.add(entry.email)
    } catch {
      // skip malformed lines
    }
  }
  return sent
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const { send, limit, resumeFile, onlyEmail } = parseArgs()

  let recipients: Recipient[]

  if (onlyEmail) {
    if (!isRealEmail(onlyEmail)) {
      throw new Error(`--email=${onlyEmail} doesn't look like a valid, sendable address`)
    }
    recipients = [{ email: onlyEmail, name: '' }]
    console.log(`🎯 --email set: sending to ONLY ${onlyEmail}, ignoring the full user list.`)
  } else {
    initializeFirebaseAdmin()
    recipients = await collectRecipients()
  }

  if (resumeFile) {
    const alreadySent = loadAlreadySent(resumeFile)
    const before = recipients.length
    recipients = recipients.filter((r) => !alreadySent.has(r.email))
    console.log(
      `↻ Resuming: skipping ${before - recipients.length} already-sent addresses from ${resumeFile}`
    )
  }

  if (limit) recipients = recipients.slice(0, limit)

  const { subject } = appUpdateTemplate({
    iosUrl: IOS_URL,
    androidUrl: ANDROID_URL,
    lang: 'ru',
  })

  console.log(`\n📊 Recipients: ${recipients.length}`)
  console.log(`📧 Subject: ${subject}`)
  console.log(`🔗 iOS: ${IOS_URL}`)
  console.log(`🔗 Android: ${ANDROID_URL}`)
  console.log('\nSample recipients:')
  for (const r of recipients.slice(0, 5)) {
    console.log(`   - ${r.email}${r.name ? ` (${r.name})` : ''}`)
  }

  if (!send) {
    console.log(
      '\n🧪 DRY RUN — nothing was sent. Re-run with --send to actually email everyone above.'
    )
    console.log('   (add --limit=25 first to test on a small batch, or --send alone for everyone)')
    return
  }

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY env var is not set')
  const from = process.env.EMAIL_FROM ?? 'Nuroo <noreply@usenuroo.com>'
  const resend = new Resend(apiKey)

  const outDir = join(process.cwd(), 'scripts', 'output')
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
  const logPath = join(outDir, `app-update-broadcast-${Date.now()}.jsonl`)
  console.log(`\n🚀 Sending for real. Log: ${logPath}\n`)

  const batches = chunk(recipients, BATCH_SIZE)
  let sentCount = 0
  let failedCount = 0

  const logSent = (email: string) =>
    appendFileSync(
      logPath,
      JSON.stringify({ email, status: 'sent', at: new Date().toISOString() }) + '\n'
    )
  const logFailed = (email: string, error: string) =>
    appendFileSync(
      logPath,
      JSON.stringify({ email, status: 'failed', error, at: new Date().toISOString() }) + '\n'
    )

  let quotaExceeded = false

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]
    try {
      // batchValidation: 'permissive' — one bad address (e.g. stray test data)
      // must not take down the other 99 real recipients in the same call.
      const { data, error } = await resend.batch.send(
        batch.map((r) => ({
          from,
          to: [r.email],
          subject,
          html: appUpdateTemplate({
            name: r.name,
            iosUrl: IOS_URL,
            androidUrl: ANDROID_URL,
            lang: 'ru',
          }).html,
        })),
        { batchValidation: 'permissive' }
      )

      if (error) {
        if (error.name === 'daily_quota_exceeded') {
          console.error(
            `\n🛑 Resend daily sending quota exhausted after ${sentCount} emails — stopping here (batch ${i + 1}/${batches.length} not attempted).`
          )
          for (const r of batch) logFailed(r.email, error.message)
          failedCount += batch.length
          quotaExceeded = true
          break
        }
        for (const r of batch) logFailed(r.email, error.message)
        failedCount += batch.length
        console.error(`❌ Batch ${i + 1}/${batches.length} failed: ${error.message}`)
      } else {
        const perEmailErrors = new Map(
          (data as any)?.errors?.map((e: any) => [e.index, e.message]) ?? []
        )
        batch.forEach((r, idx) => {
          const err = perEmailErrors.get(idx)
          if (err) {
            logFailed(r.email, String(err))
            failedCount++
          } else {
            logSent(r.email)
            sentCount++
          }
        })
        const failedInBatch = perEmailErrors.size
        console.log(
          `✅ Batch ${i + 1}/${batches.length}: ${batch.length - failedInBatch} sent${failedInBatch ? `, ${failedInBatch} failed` : ''}`
        )
      }
    } catch (e: any) {
      for (const r of batch) logFailed(r.email, e?.message ?? 'unknown')
      failedCount += batch.length
      console.error(`❌ Batch ${i + 1}/${batches.length} threw: ${e?.message}`)
    }

    if (i < batches.length - 1) await sleep(DELAY_BETWEEN_BATCHES_MS)
  }

  console.log(`\n✅ Done. Sent: ${sentCount}, Failed: ${failedCount}`)
  if (quotaExceeded) {
    console.log(
      `   Hit your Resend daily quota. Wait for it to reset (or upgrade your Resend plan), then:`
    )
    console.log(`   Re-run with --resume=${logPath} to send only to the ones still pending.`)
  } else if (failedCount > 0) {
    console.log(`   Re-run with --resume=${logPath} to retry only the ones that failed.`)
  }
}

main().catch((e) => {
  console.error('❌ Fatal error:', e)
  process.exit(1)
})
