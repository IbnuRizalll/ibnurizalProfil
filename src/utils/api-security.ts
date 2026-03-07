interface RateLimitRecord {
  count: number
  resetAt: number
}

interface ConsumeRateLimitOptions {
  namespace: string
  key: string
  maxRequests: number
  windowMs: number
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
}

interface OriginValidationOptions {
  allowNoOrigin?: boolean
}
interface CsrfValidationOptions {
  cookieName?: string
  headerName?: string
  allowMissingCookie?: boolean
}

const rateLimitStore = new Map<string, RateLimitRecord>()
const RATE_LIMIT_MAX_KEYS = 5000
const RATE_LIMIT_PRUNE_INTERVAL_MS = 60 * 1000
const DEFAULT_CSRF_COOKIE_NAME = 'csrf_token'
const DEFAULT_CSRF_HEADER_NAME = 'x-csrf-token'
let lastPruneAt = 0

function pruneRateLimitStore(now: number): void {
  const shouldPrune = now - lastPruneAt >= RATE_LIMIT_PRUNE_INTERVAL_MS || rateLimitStore.size > RATE_LIMIT_MAX_KEYS
  if (!shouldPrune) return

  for (const [key, record] of rateLimitStore.entries()) {
    if (record.resetAt <= now) {
      rateLimitStore.delete(key)
    }
  }

  if (rateLimitStore.size > RATE_LIMIT_MAX_KEYS) {
    const entries = [...rateLimitStore.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt)
    const extraCount = rateLimitStore.size - RATE_LIMIT_MAX_KEYS
    for (let index = 0; index < extraCount; index += 1) {
      const keyToDelete = entries[index]?.[0]
      if (keyToDelete) {
        rateLimitStore.delete(keyToDelete)
      }
    }
  }

  lastPruneAt = now
}

function getFirstHeaderValue(value: string | null): string {
  if (!value) return ''
  return value
    .split(',')
    .map((entry) => entry.trim())
    .find(Boolean) || ''
}

function sanitizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_.:@|-]/g, '-').slice(0, 180)
}

function parseCookies(request: Request): Record<string, string> {
  const raw = request.headers.get('cookie') || ''
  if (!raw) return {}

  const cookiePairs = raw.split(';')
  const parsed: Record<string, string> = {}

  for (const pair of cookiePairs) {
    const separator = pair.indexOf('=')
    if (separator < 0) continue
    const key = pair.slice(0, separator).trim()
    const value = pair.slice(separator + 1).trim()
    if (!key) continue
    try {
      parsed[key] = decodeURIComponent(value)
    } catch {
      parsed[key] = value
    }
  }

  return parsed
}

export function getClientIdentifier(request: Request): string {
  const forwardedIp = getFirstHeaderValue(request.headers.get('x-forwarded-for'))
  const realIp = getFirstHeaderValue(request.headers.get('x-real-ip'))
  const cfIp = getFirstHeaderValue(request.headers.get('cf-connecting-ip'))
  const clientIp = sanitizeKey(forwardedIp || realIp || cfIp || 'unknown-ip')

  const userAgent = sanitizeKey((request.headers.get('user-agent') || 'unknown-ua').slice(0, 120))
  return `${clientIp}|${userAgent}`
}

export function consumeRateLimit(options: ConsumeRateLimitOptions): RateLimitResult {
  const now = Date.now()
  pruneRateLimitStore(now)

  const namespace = sanitizeKey(options.namespace || 'default')
  const key = sanitizeKey(options.key || 'anonymous')
  const recordKey = `${namespace}:${key}`

  const existing = rateLimitStore.get(recordKey)
  if (!existing || existing.resetAt <= now) {
    rateLimitStore.set(recordKey, {
      count: 1,
      resetAt: now + options.windowMs,
    })

    return {
      allowed: true,
      remaining: Math.max(0, options.maxRequests - 1),
      retryAfterSeconds: 0,
    }
  }

  existing.count += 1
  rateLimitStore.set(recordKey, existing)

  if (existing.count > options.maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    }
  }

  return {
    allowed: true,
    remaining: Math.max(0, options.maxRequests - existing.count),
    retryAfterSeconds: 0,
  }
}

export function isAllowedRequestOrigin(request: Request, options: OriginValidationOptions = {}): boolean {
  const { allowNoOrigin = true } = options
  const originHeader = request.headers.get('origin')
  if (!originHeader) return allowNoOrigin

  try {
    const origin = new URL(originHeader).origin
    const requestOrigin = new URL(request.url).origin
    return origin === requestOrigin
  } catch {
    return false
  }
}

export function isTrustedFetchSite(request: Request): boolean {
  const fetchSite = (request.headers.get('sec-fetch-site') || '').trim().toLowerCase()
  if (!fetchSite) return true
  return fetchSite === 'same-origin' || fetchSite === 'same-site' || fetchSite === 'none'
}

export function hasJsonContentType(request: Request): boolean {
  const contentType = (request.headers.get('content-type') || '').toLowerCase()
  return contentType.startsWith('application/json')
}

export function hasMultipartContentType(request: Request): boolean {
  const contentType = (request.headers.get('content-type') || '').toLowerCase()
  return contentType.startsWith('multipart/form-data')
}

export function hasValidCsrfToken(request: Request, options: CsrfValidationOptions = {}): boolean {
  const cookieName = options.cookieName || DEFAULT_CSRF_COOKIE_NAME
  const headerName = options.headerName || DEFAULT_CSRF_HEADER_NAME
  const allowMissingCookie = options.allowMissingCookie ?? false

  const headerToken = (request.headers.get(headerName) || '').trim()
  if (!headerToken) return false

  const cookies = parseCookies(request)
  const cookieToken = (cookies[cookieName] || '').trim()

  if (!cookieToken) {
    return allowMissingCookie
  }

  return cookieToken === headerToken
}

export function hasPayloadTooLarge(request: Request, maxBytes: number): boolean {
  const contentLength = request.headers.get('content-length')
  if (!contentLength) return false

  const size = Number.parseInt(contentLength, 10)
  if (!Number.isFinite(size) || size < 0) return false
  return size > maxBytes
}

export function jsonResponse(
  payload: unknown,
  status = 200,
  additionalHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...additionalHeaders,
    },
  })
}
