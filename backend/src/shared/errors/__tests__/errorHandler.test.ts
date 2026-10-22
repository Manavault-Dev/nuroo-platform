import { describe, it, expect, afterEach } from 'vitest'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { buildErrorHandler } from '../errorHandler.js'
import { AppError } from '../AppError.js'
import { NotFoundError } from '../NotFoundError.js'
import { ForbiddenError } from '../ForbiddenError.js'

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.setErrorHandler(buildErrorHandler(app))

  app.get('/throw-app-error', async () => {
    throw new AppError('Custom failure', 409, 'CUSTOM_CONFLICT')
  })

  app.get('/throw-not-found', async () => {
    throw new NotFoundError('Organization', 'org_123')
  })

  app.get('/throw-forbidden', async () => {
    throw new ForbiddenError()
  })

  app.get('/throw-plain-error', async () => {
    throw new Error('something broke internally, includes a stack trace and db details')
  })

  app.get('/throw-with-statuscode', async () => {
    const err = new Error('Payload too large') as Error & { statusCode: number }
    err.statusCode = 413
    throw err
  })

  app.post(
    '/validated',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string' } },
        },
      },
    },
    async (request) => {
      return { ok: true, body: request.body }
    }
  )

  await app.ready()
  return app
}

describe('buildErrorHandler', () => {
  let app: FastifyInstance

  afterEach(async () => {
    await app?.close()
  })

  it('formats a thrown AppError using its own statusCode/code/message', async () => {
    app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/throw-app-error' })

    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({ error: 'Custom failure', code: 'CUSTOM_CONFLICT' })
  })

  it('formats a thrown NotFoundError as 404 with the generated message', async () => {
    app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/throw-not-found' })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({
      error: "Organization with id 'org_123' not found",
      code: 'NOT_FOUND',
    })
  })

  it('formats a thrown ForbiddenError as 403', async () => {
    app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/throw-forbidden' })

    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ error: 'Access denied', code: 'FORBIDDEN' })
  })

  it('never leaks a plain unhandled Error message — returns a generic 500', async () => {
    app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/throw-plain-error' })

    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: 'Internal server error', code: 'INTERNAL_ERROR' })
    expect(res.payload).not.toContain('db details')
  })

  it('respects an explicit statusCode on a non-AppError 4xx error and passes its message through', async () => {
    app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/throw-with-statuscode' })

    expect(res.statusCode).toBe(413)
    expect(res.json()).toEqual({ error: 'Payload too large', code: 'REQUEST_ERROR' })
  })

  it('formats a Fastify schema validation failure as 400 VALIDATION_ERROR instead of the default shape', async () => {
    app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/validated',
      payload: {},
    })

    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.code).toBe('VALIDATION_ERROR')
    expect(body.error).toContain('name')
  })

  it('passes a valid request through untouched', async () => {
    app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/validated',
      payload: { name: 'ok' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, body: { name: 'ok' } })
  })
})
