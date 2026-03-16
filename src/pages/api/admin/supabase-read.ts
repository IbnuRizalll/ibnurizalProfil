import type { APIRoute } from 'astro'
import {
  consumeRateLimit,
  getClientIdentifier,
  hasJsonContentType,
  hasPayloadTooLarge,
  hasValidCsrfToken,
  isAllowedRequestOrigin,
  isTrustedFetchSite,
  jsonResponse,
} from '@server/security/api-security'
import {
  getBearerToken,
  getSupabaseServerConfig,
  isAdminEmailAllowed,
  readJsonSafe,
  readResponseError,
  verifySupabaseAccessToken,
} from '@server/supabase/server'

type AdminReadableTable = 'projects' | 'blog_posts'

interface AdminReadBody {
  table: string
  limit?: number
}

const ALLOWED_TABLES = new Set<AdminReadableTable>(['projects', 'blog_posts'])
const IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]*$/i
const MAX_REQUEST_BYTES = 8 * 1024
const MAX_LIMIT = 200

const TABLE_SELECTS: Record<AdminReadableTable, { latest: string; legacy: string }> = {
  projects: {
    latest:
      'id, slug, title, author, description, tags, body, cover_image_url, content_blocks, is_visible, created_at, updated_at',
    legacy: 'id, slug, title, author, description, tags, body, created_at, updated_at',
  },
  blog_posts: {
    latest:
      'id, slug, title, author, description, tags, body, cover_image_url, content_blocks, is_visible, created_at, updated_at',
    legacy: 'id, slug, title, author, description, tags, body, created_at, updated_at',
  },
}

function sanitizeText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maxLength)
}

function sanitizeLimit(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return MAX_LIMIT
  return Math.min(MAX_LIMIT, parsed)
}

function isReadableTable(value: string): value is AdminReadableTable {
  return ALLOWED_TABLES.has(value as AdminReadableTable)
}

function buildEndpoint(baseUrl: string, table: AdminReadableTable, select: string, limit: number): URL {
  const endpoint = new URL(`${baseUrl}/rest/v1/${table}`)
  endpoint.searchParams.set('select', select)
  endpoint.searchParams.set('order', 'updated_at.desc')
  endpoint.searchParams.set('limit', String(limit))
  return endpoint
}

async function fetchTableRows(
  config: NonNullable<ReturnType<typeof getSupabaseServerConfig>>,
  accessToken: string,
  table: AdminReadableTable,
  limit: number,
) {
  const selects = TABLE_SELECTS[table]

  for (const select of [selects.latest, selects.legacy]) {
    const response = await fetch(buildEndpoint(config.url, table, select, limit).toString(), {
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (response.ok) {
      return {
        ok: true as const,
        data: (await readJsonSafe<unknown[]>(response)) ?? [],
      }
    }

    if (select === selects.legacy) {
      return {
        ok: false as const,
        status: response.status,
        error: await readResponseError(response, 'Admin read request failed.'),
      }
    }
  }

  return {
    ok: false as const,
    status: 500,
    error: 'Admin read request failed.',
  }
}

export const POST: APIRoute = async ({ request }) => {
  if (!isAllowedRequestOrigin(request, { allowNoOrigin: false })) {
    return jsonResponse({ error: 'Origin request tidak diizinkan.' }, 403)
  }

  if (!isTrustedFetchSite(request)) {
    return jsonResponse({ error: 'Request context tidak diizinkan.' }, 403)
  }

  if (!hasValidCsrfToken(request)) {
    return jsonResponse({ error: 'Sesi keamanan tidak valid. Silakan refresh halaman lalu coba lagi.' }, 403)
  }

  if (!hasJsonContentType(request)) {
    return jsonResponse({ error: 'Content-Type harus application/json.' }, 415)
  }

  if (hasPayloadTooLarge(request, MAX_REQUEST_BYTES)) {
    return jsonResponse({ error: 'Ukuran data melebihi batas.' }, 413)
  }

  const rateLimit = consumeRateLimit({
    namespace: 'admin-supabase-read',
    key: getClientIdentifier(request),
    maxRequests: 180,
    windowMs: 10 * 60 * 1000,
  })

  if (!rateLimit.allowed) {
    return jsonResponse({ error: 'Terlalu banyak permintaan. Silakan coba lagi beberapa saat lagi.' }, 429, {
      'Retry-After': String(rateLimit.retryAfterSeconds),
    })
  }

  const config = getSupabaseServerConfig()
  if (!config) {
    return jsonResponse({ error: 'Layanan backend belum tersedia.' }, 503)
  }

  const accessToken = getBearerToken(request.headers.get('authorization'))
  const authResult = await verifySupabaseAccessToken(config, accessToken)
  if (!authResult.ok || !accessToken) {
    return jsonResponse({ error: authResult.error ?? 'Unauthorized.' }, 401)
  }
  if (!isAdminEmailAllowed(authResult.email)) {
    return jsonResponse({ error: 'Forbidden.' }, 403)
  }

  const body = await readJsonSafe<AdminReadBody>(request)
  if (!body) {
    return jsonResponse({ error: 'Invalid JSON payload.' }, 400)
  }

  const table = sanitizeText(body.table, 40)
  if (!IDENTIFIER_PATTERN.test(table) || !isReadableTable(table)) {
    return jsonResponse({ error: 'Table is not allowed for this endpoint.' }, 403)
  }

  const limit = sanitizeLimit(body.limit)
  const result = await fetchTableRows(config, accessToken, table, limit)

  if (!result.ok) {
    if (result.status >= 500) {
      return jsonResponse({ error: 'Data service error. Please retry.' }, 502)
    }

    return jsonResponse(
      { error: import.meta.env.DEV ? result.error : 'Read request was rejected by backend policy.' },
      result.status,
    )
  }

  return jsonResponse({ success: true, data: result.data }, 200)
}
