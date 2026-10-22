import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { AppError } from './AppError.js'

/**
 * Centralized error contract for the API. Most routes already catch their own
 * errors and reply with a {error, code} shape directly — this only fires for
 * errors that escape a route's own try/catch (a real bug) and for Fastify's
 * own schema validation failures, which otherwise fall back to Fastify's
 * default {statusCode, error, message} shape instead of this API's
 * {error, code} convention.
 *
 * Extracted from index.ts so it can be unit tested without building the full
 * application (Firebase init, all 23 domains, etc).
 */
export function buildErrorHandler(fastify: FastifyInstance) {
  return function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
    if (error instanceof AppError) {
      if (error.statusCode >= 500) {
        fastify.log.error({
          event: 'app_error',
          code: error.code,
          message: error.message,
          url: request.url,
        })
      }
      return reply.code(error.statusCode).send({ error: error.message, code: error.code })
    }

    if (error.validation) {
      const message =
        error.validation
          .map((issue) => issue.message)
          .filter(Boolean)
          .join('; ') || 'Invalid request'
      return reply.code(400).send({ error: message, code: 'VALIDATION_ERROR' })
    }

    const statusCode =
      error.statusCode && error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500

    if (statusCode >= 500) {
      fastify.log.error({
        event: 'unhandled_error',
        message: error.message,
        stack: error.stack,
        url: request.url,
      })
      return reply.code(statusCode).send({ error: 'Internal server error', code: 'INTERNAL_ERROR' })
    }

    fastify.log.warn({ event: 'request_error', message: error.message, url: request.url })
    return reply
      .code(statusCode)
      .send({ error: error.message || 'Request error', code: error.code ?? 'REQUEST_ERROR' })
  }
}
