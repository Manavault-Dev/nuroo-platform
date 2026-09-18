import type { FastifyPluginAsync } from 'fastify'

/**
 * Free-tier replacement for Sentry's native Slack integration (that one
 * needs a paid Team plan). Point a Sentry "Issue Alert" rule's Webhook
 * action at this URL — Sentry's payload shape has varied across alert
 * types over the years, so field extraction below tries several known
 * shapes rather than assuming one.
 */

interface SentryWebhookBody {
  action?: string
  data?: {
    event?: Record<string, unknown>
    issue?: Record<string, unknown>
  }
  culprit?: string
  message?: string
  url?: string
  level?: string
  project_name?: string
  project?: string
  [key: string]: unknown
}

function pick(...values: unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v
  }
  return undefined
}

function extractFields(body: SentryWebhookBody) {
  const event = body.data?.event ?? {}
  const issue = body.data?.issue ?? {}

  const title = pick(event.title as string, issue.title as string, body.message, 'New Sentry event')
  const culprit = pick(event.culprit as string, issue.culprit as string, body.culprit)
  const url = pick(
    event.web_url as string,
    issue.permalink as string,
    (issue as any).web_url,
    body.url
  )
  const level = pick(event.level as string, issue.level as string, body.level, 'error')
  const project = pick(body.project_name, body.project)

  return { title, culprit, url, level, project }
}

export const sentryAlertRoute: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Querystring: { secret?: string } }>(
    '/webhooks/sentry-alert',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const expected = process.env.SENTRY_WEBHOOK_SECRET
      if (!expected) {
        fastify.log.error('SENTRY_WEBHOOK_SECRET is not set — rejecting Sentry webhook call')
        return reply.code(503).send({ error: 'Webhook not configured' })
      }
      if (request.query.secret !== expected) {
        return reply.code(401).send({ error: 'Unauthorized' })
      }

      const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL
      if (!slackWebhookUrl) {
        fastify.log.error('SLACK_WEBHOOK_URL is not set — cannot relay Sentry alert')
        return reply.code(503).send({ error: 'Slack relay not configured' })
      }

      const { title, culprit, url, level, project } = extractFields(
        request.body as SentryWebhookBody
      )

      const levelEmoji: Record<string, string> = {
        fatal: '🔴',
        error: '🟠',
        warning: '🟡',
      }

      const lines = [
        `${levelEmoji[level ?? 'error'] ?? '🔴'} *${title}*`,
        project ? `Project: ${project}` : null,
        culprit ? `Where: \`${culprit}\`` : null,
        url ? `<${url}|View in Sentry>` : null,
      ].filter(Boolean)

      try {
        const res = await fetch(slackWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: lines.join('\n') }),
        })
        if (!res.ok) {
          fastify.log.error(`Slack relay failed: HTTP ${res.status}`)
        }
      } catch (err) {
        fastify.log.error({ err }, 'Failed to relay Sentry alert to Slack')
      }

      return { ok: true }
    }
  )
}
