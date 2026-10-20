import type { RequestHandler } from 'express'
import { randomUUID } from 'node:crypto'

import { env } from '~/configs/env'

export function createRequestLogger(
  write: (line: string) => void = console.info,
  enabled = env.NODE_ENV !== 'test'
): RequestHandler {
  return (req, res, next) => {
    const candidate = req.get('X-Request-Id')
    const requestId = candidate && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(candidate) ? candidate : randomUUID()
    const started = performance.now()
    res.locals.requestId = requestId
    res.setHeader('X-Request-Id', requestId)
    res.once('finish', () => {
      if (!enabled) return
      const entry = {
        requestId,
        method: req.method,
        status: res.statusCode,
        route: typeof req.route?.path === 'string' ? req.route.path : '[unmatched]',
        durationMs: Math.round((performance.now() - started) * 100) / 100
      }
      write(JSON.stringify(entry).replace(/[\u2028\u2029]/g, ' '))
    })
    next()
  }
}

export const requestLogger = createRequestLogger()
