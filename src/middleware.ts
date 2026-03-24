import { defineMiddleware } from 'astro:middleware'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const CSRF_COOKIE_NAME = 'csrf_token'
const ADMIN_ACCESS_COOKIE_NAME = 'admin_access'
const CSRF_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 8

const DEFAULT_SECURITY_HEADERS: Record<string, string> = {
  'X-DNS-Prefetch-Control': 'off',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Origin-Agent-Cluster': '?1',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; form-action 'self'; frame-src 'none'; img-src 'self' data: blob: https:; font-src 'self' data:; script-src 'self' 'unsafe-inline' data: https://esm.sh; style-src 'self' 'unsafe-inline'; connect-src 'self' https://*.supabase.co https://esm.sh",
}

function setHeaderIfMissing(response: Response, key: string, value: string): void {
  if (!response.headers.has(key)) {
    response.headers.set(key, value)
  }
}

export const onRequest = defineMiddleware(async (context, next) => {
  const isHttps = context.url.protocol === 'https:'
  const isLocal = LOCAL_HOSTS.has(context.url.hostname)
  const requestPath = context.url.pathname
  const isSensitivePath = requestPath === '/login' || requestPath.startsWith('/admin')
  const acceptsHtml = context.request.headers.get('accept')?.includes('text/html') ?? false
  const isAdminRootPath = requestPath === '/admin'
  const isAdminPagePath = isAdminRootPath || requestPath.startsWith('/admin/')

  if (context.request.method === 'GET' && acceptsHtml && isAdminPagePath) {
    const hasAdminAccessCookie = context.cookies.get(ADMIN_ACCESS_COOKIE_NAME)?.value === '1'
    const nextAdminPath = isAdminRootPath ? '/admin/about' : `${requestPath}${context.url.search}`

    if (!hasAdminAccessCookie) {
      return context.redirect(`/login?next=${encodeURIComponent(nextAdminPath)}`, 302)
    }

    if (isAdminRootPath) {
      return context.redirect('/admin/about', 302)
    }
  }

  if (context.request.method === 'GET' && acceptsHtml) {
    const existingToken = context.cookies.get(CSRF_COOKIE_NAME)?.value
    if (!existingToken) {
      context.cookies.set(CSRF_COOKIE_NAME, crypto.randomUUID(), {
        path: '/',
        sameSite: 'strict',
        secure: isHttps && !isLocal,
        httpOnly: false,
        maxAge: CSRF_COOKIE_MAX_AGE_SECONDS,
      })
    }
  }

  const response = await next()
  const securedResponse = new Response(response.body, response)

  for (const [key, value] of Object.entries(DEFAULT_SECURITY_HEADERS)) {
    setHeaderIfMissing(securedResponse, key, value)
  }

  if (isHttps && !isLocal) {
    setHeaderIfMissing(securedResponse, 'Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload')
  }

  if (isSensitivePath) {
    securedResponse.headers.set('Cache-Control', 'no-store')
  }

  return securedResponse
})
