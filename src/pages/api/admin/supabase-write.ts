import type { APIRoute } from 'astro'
import {
  consumeRateLimit,
  getClientIdentifier,
  hasPayloadTooLarge,
  isAllowedRequestOrigin,
  isTrustedFetchSite,
  hasValidCsrfToken,
  hasJsonContentType,
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

type WriteAction = 'insert' | 'update' | 'upsert' | 'delete'
type FilterOperator = 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte' | 'like' | 'ilike' | 'is' | 'in'
type AdminTable = 'site_settings' | 'projects' | 'blog_posts' | 'contact_messages'

interface FilterInput {
  column: string
  operator?: FilterOperator
  value: unknown
}

interface AdminWriteBody {
  table: string
  action: WriteAction
  payload?: unknown
  filters?: FilterInput[]
  onConflict?: string
}

interface SanitizationResult<T> {
  value?: T
  error?: string
}

const ALLOWED_TABLES = new Set<AdminTable>(['site_settings', 'projects', 'blog_posts', 'contact_messages'])
const ALLOWED_WRITE_ACTIONS = new Set<WriteAction>(['insert', 'update', 'upsert', 'delete'])
const ALLOWED_OPERATORS = new Set<FilterOperator>(['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'like', 'ilike', 'is', 'in'])
const IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]*$/i
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i
const PHONE_PATTERN = /^\+?[0-9()\s.-]{8,20}$/
const MAX_REQUEST_BYTES = 512 * 1024
const MAX_BULK_ROWS = 30
const MAX_FILTERS = 8
const MAX_CONTENT_BLOCKS = 120
const MAX_TABLE_COLUMNS = 24
const MAX_TABLE_ROWS = 400

const TABLE_WRITE_COLUMNS: Record<AdminTable, Set<string>> = {
  site_settings: new Set([
    'id',
    'logo_url',
    'home_image_url',
    'hero_description',
    'about_me',
    'created_at',
    'updated_at',
  ]),
  projects: new Set([
    'id',
    'slug',
    'title',
    'author',
    'description',
    'tags',
    'body',
    'cover_image_url',
    'content_blocks',
    'created_at',
    'updated_at',
  ]),
  blog_posts: new Set([
    'id',
    'slug',
    'title',
    'author',
    'description',
    'tags',
    'body',
    'cover_image_url',
    'content_blocks',
    'created_at',
    'updated_at',
  ]),
  contact_messages: new Set([
    'id',
    'full_name',
    'email',
    'phone',
    'message',
    'is_read',
    'replied_via',
    'replied_at',
    'created_at',
    'updated_at',
  ]),
}

const TABLE_FILTER_COLUMNS: Record<AdminTable, Set<string>> = {
  site_settings: new Set(['id']),
  projects: new Set(['id', 'slug', 'author', 'created_at', 'updated_at']),
  blog_posts: new Set(['id', 'slug', 'author', 'created_at', 'updated_at']),
  contact_messages: new Set(['id', 'email', 'phone', 'is_read', 'replied_via', 'created_at', 'updated_at']),
}

const ASSETS_BUCKET = import.meta.env.PUBLIC_SUPABASE_ASSETS_BUCKET ?? 'site-assets'
const ALLOWED_REPLIED_VIA = new Set(['email', 'whatsapp', 'phone'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAdminTable(value: string): value is AdminTable {
  return ALLOWED_TABLES.has(value as AdminTable)
}

function sanitizeText(value: unknown, maxLength: number, allowNewLines = false): string {
  if (typeof value !== 'string') return ''

  let normalized = ''
  for (const character of value) {
    const code = character.charCodeAt(0)
    const isControl = code < 32 || code === 127
    if (!isControl) {
      normalized += character
      continue
    }
    if (allowNewLines && (character === '\n' || character === '\r' || character === '\t')) {
      normalized += character
    }
  }

  return normalized.trim().slice(0, maxLength)
}

function sanitizeSlug(value: unknown): string {
  return sanitizeText(value, 140)
    .toLowerCase()
    .replace(/\s+/g, '-')
}

function sanitizeUuid(value: unknown): string {
  const normalized = sanitizeText(value, 48).toLowerCase()
  return UUID_PATTERN.test(normalized) ? normalized : ''
}

function sanitizeTimestamp(value: unknown, options: { allowNull?: boolean } = {}): string | null | undefined {
  const { allowNull = false } = options
  if (value === undefined) return undefined
  if (value === null) return allowNull ? null : undefined

  const raw = sanitizeText(value, 64)
  if (!raw) return allowNull ? null : undefined
  const timestamp = Date.parse(raw)
  if (Number.isNaN(timestamp)) return undefined
  return new Date(timestamp).toISOString()
}

function sanitizeAssetUrl(value: unknown, options: { allowNull?: boolean } = {}): string | null | undefined {
  const { allowNull = true } = options
  if (value === undefined) return undefined
  if (value === null) return allowNull ? null : undefined

  const candidate = sanitizeText(value, 2048)
  if (!candidate) return allowNull ? null : undefined
  const lowerCandidate = candidate.toLowerCase()
  if (
    lowerCandidate.startsWith('javascript:') ||
    lowerCandidate.startsWith('vbscript:') ||
    lowerCandidate.startsWith('file:')
  ) {
    return undefined
  }

  const isSafePath = candidate.startsWith('/')
  const isStoragePath = candidate.startsWith('storage/v1/object/public/') || candidate.startsWith(`${ASSETS_BUCKET}/`)
  const isAbsoluteHttp = candidate.startsWith('https://') || candidate.startsWith('http://')

  if (isSafePath || isStoragePath || isAbsoluteHttp) {
    return candidate
  }

  return undefined
}

function sanitizeTags(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : null

  if (!source) return undefined

  const seen = new Set<string>()
  const normalized: string[] = []

  for (const entry of source) {
    const cleaned = sanitizeText(entry, 50).toLowerCase()
    if (!cleaned || seen.has(cleaned)) continue
    seen.add(cleaned)
    normalized.push(cleaned)
    if (normalized.length >= 20) break
  }

  return normalized
}

function sanitizeContentBlocks(raw: unknown): unknown[] | undefined {
  if (raw === undefined) return undefined

  let source: unknown = raw
  if (typeof source === 'string') {
    const trimmed = source.trim()
    if (!trimmed) return []
    try {
      source = JSON.parse(trimmed)
    } catch {
      return undefined
    }
  }

  if (!Array.isArray(source)) {
    return undefined
  }

  const normalizedBlocks: unknown[] = []

  for (let index = 0; index < source.length; index += 1) {
    const block = source[index]
    if (!isRecord(block)) continue
    if (normalizedBlocks.length >= MAX_CONTENT_BLOCKS) break

    const type = sanitizeText(block.type, 24).toLowerCase()
    const id = sanitizeText(block.id, 64) || `block-${index + 1}`

    if (type === 'paragraph') {
      const text = sanitizeText(block.text, 12000, true)
      if (!text) continue
      normalizedBlocks.push({ id, type: 'paragraph', text })
      continue
    }

    if (type === 'image') {
      const url = sanitizeAssetUrl(block.url, { allowNull: false })
      if (!url) continue
      normalizedBlocks.push({
        id,
        type: 'image',
        url,
        alt: sanitizeText(block.alt, 220),
        caption: sanitizeText(block.caption, 360),
      })
      continue
    }

    if (type === 'table') {
      const headers = Array.isArray(block.headers)
        ? block.headers.map((cell) => sanitizeText(cell, 180)).slice(0, MAX_TABLE_COLUMNS)
        : []

      const rows = Array.isArray(block.rows)
        ? block.rows
            .slice(0, MAX_TABLE_ROWS)
            .map((row) =>
              Array.isArray(row)
                ? row
                    .slice(0, MAX_TABLE_COLUMNS)
                    .map((cell) => sanitizeText(cell, 400, true))
                : [],
            )
            .filter((row) => row.length > 0 && row.some((cell) => cell.length > 0))
        : []

      if (headers.length === 0 && rows.length === 0) continue

      normalizedBlocks.push({
        id,
        type: 'table',
        caption: sanitizeText(block.caption, 320),
        headers,
        rows,
      })
    }
  }

  return normalizedBlocks
}

function sanitizeCommonContentPayload(
  table: 'projects' | 'blog_posts',
  action: WriteAction,
  input: Record<string, unknown>,
): SanitizationResult<Record<string, unknown>> {
  const allowedColumns = TABLE_WRITE_COLUMNS[table]
  for (const key of Object.keys(input)) {
    if (!allowedColumns.has(key)) {
      return { error: `Field "${key}" is not allowed for ${table}.` }
    }
  }

  const payload: Record<string, unknown> = {}

  if ('id' in input) {
    const id = sanitizeUuid(input.id)
    if (!id) return { error: 'Invalid id format.' }
    payload.id = id
  }

  if ('slug' in input) {
    const slug = sanitizeSlug(input.slug)
    if (!slug || !SLUG_PATTERN.test(slug)) {
      return { error: 'Invalid slug format.' }
    }
    payload.slug = slug
  }

  if ('title' in input) {
    const title = sanitizeText(input.title, 180, true)
    if (!title) return { error: 'Title is required.' }
    payload.title = title
  }

  if ('author' in input) {
    const author = sanitizeText(input.author, 120)
    if (!author) return { error: 'Author is required.' }
    payload.author = author
  }

  if ('description' in input) {
    const description = sanitizeText(input.description, 600, true)
    if (!description) return { error: 'Description is required.' }
    payload.description = description
  }

  if ('body' in input) {
    payload.body = sanitizeText(input.body, 120000, true)
  }

  if ('tags' in input) {
    const tags = sanitizeTags(input.tags)
    if (!tags) return { error: 'Invalid tags format.' }
    payload.tags = tags
  }

  if ('cover_image_url' in input) {
    const coverImageUrl = sanitizeAssetUrl(input.cover_image_url, { allowNull: true })
    if (coverImageUrl === undefined) {
      return { error: 'Invalid cover image URL.' }
    }
    payload.cover_image_url = coverImageUrl
  }

  if ('content_blocks' in input) {
    const contentBlocks = sanitizeContentBlocks(input.content_blocks)
    if (contentBlocks === undefined) return { error: 'Invalid content blocks format.' }
    payload.content_blocks = contentBlocks
  }

  if ('created_at' in input) {
    const createdAt = sanitizeTimestamp(input.created_at)
    if (!createdAt) return { error: 'Invalid created_at timestamp.' }
    payload.created_at = createdAt
  }

  if ('updated_at' in input) {
    const updatedAt = sanitizeTimestamp(input.updated_at)
    if (!updatedAt) return { error: 'Invalid updated_at timestamp.' }
    payload.updated_at = updatedAt
  }

  if (action === 'insert' || action === 'upsert') {
    if (typeof payload.slug !== 'string' || typeof payload.title !== 'string') {
      return { error: 'Slug and title are required for insert/upsert.' }
    }

    if (typeof payload.author !== 'string' || typeof payload.description !== 'string') {
      return { error: 'Author and description are required for insert/upsert.' }
    }
  }

  return { value: payload }
}

function sanitizeSiteSettingsPayload(
  action: WriteAction,
  input: Record<string, unknown>,
): SanitizationResult<Record<string, unknown>> {
  const allowedColumns = TABLE_WRITE_COLUMNS.site_settings
  for (const key of Object.keys(input)) {
    if (!allowedColumns.has(key)) {
      return { error: `Field "${key}" is not allowed for site_settings.` }
    }
  }

  const payload: Record<string, unknown> = {}

  if ('id' in input) {
    const id = sanitizeText(input.id, 32).toLowerCase()
    if (!id || id !== 'main') return { error: 'site_settings id must be "main".' }
    payload.id = id
  }

  if ('logo_url' in input) {
    const logoUrl = sanitizeAssetUrl(input.logo_url, { allowNull: true })
    if (logoUrl === undefined) return { error: 'Invalid logo URL.' }
    payload.logo_url = logoUrl
  }

  if ('home_image_url' in input) {
    const homeImageUrl = sanitizeAssetUrl(input.home_image_url, { allowNull: false })
    if (!homeImageUrl) return { error: 'Invalid home image URL.' }
    payload.home_image_url = homeImageUrl
  }

  if ('hero_description' in input) {
    const heroDescription = sanitizeText(input.hero_description, 500, true)
    if (!heroDescription) return { error: 'Hero description cannot be empty.' }
    payload.hero_description = heroDescription
  }

  if ('about_me' in input) {
    const aboutMe = sanitizeText(input.about_me, 16000, true)
    if (!aboutMe) return { error: 'About me cannot be empty.' }
    payload.about_me = aboutMe
  }

  if ('created_at' in input) {
    const createdAt = sanitizeTimestamp(input.created_at)
    if (!createdAt) return { error: 'Invalid created_at timestamp.' }
    payload.created_at = createdAt
  }

  if ('updated_at' in input) {
    const updatedAt = sanitizeTimestamp(input.updated_at)
    if (!updatedAt) return { error: 'Invalid updated_at timestamp.' }
    payload.updated_at = updatedAt
  }

  if ((action === 'insert' || action === 'upsert') && !('id' in payload)) {
    payload.id = 'main'
  }

  return { value: payload }
}

function sanitizeContactMessagePayload(
  action: WriteAction,
  input: Record<string, unknown>,
): SanitizationResult<Record<string, unknown>> {
  const allowedColumns = TABLE_WRITE_COLUMNS.contact_messages
  for (const key of Object.keys(input)) {
    if (!allowedColumns.has(key)) {
      return { error: `Field "${key}" is not allowed for contact_messages.` }
    }
  }

  const payload: Record<string, unknown> = {}

  if ('id' in input) {
    const id = sanitizeUuid(input.id)
    if (!id) return { error: 'Invalid id format.' }
    payload.id = id
  }

  if ('full_name' in input) {
    const fullName = sanitizeText(input.full_name, 120, true)
    if (!fullName) return { error: 'full_name cannot be empty.' }
    payload.full_name = fullName
  }

  if ('email' in input) {
    const email = sanitizeText(input.email, 180).toLowerCase()
    if (!EMAIL_PATTERN.test(email)) return { error: 'Invalid email format.' }
    payload.email = email
  }

  if ('phone' in input) {
    const phone = sanitizeText(input.phone, 24)
    if (!PHONE_PATTERN.test(phone)) return { error: 'Invalid phone format.' }
    payload.phone = phone
  }

  if ('message' in input) {
    const message = sanitizeText(input.message, 4000, true)
    if (!message) return { error: 'message cannot be empty.' }
    payload.message = message
  }

  if ('is_read' in input) {
    if (typeof input.is_read !== 'boolean') return { error: 'is_read must be a boolean.' }
    payload.is_read = input.is_read
  }

  if ('replied_via' in input) {
    if (input.replied_via === null) {
      payload.replied_via = null
    } else {
      const repliedVia = sanitizeText(input.replied_via, 24).toLowerCase()
      if (!ALLOWED_REPLIED_VIA.has(repliedVia)) {
        return { error: 'replied_via must be email or whatsapp.' }
      }
      payload.replied_via = repliedVia
    }
  }

  if ('replied_at' in input) {
    const repliedAt = sanitizeTimestamp(input.replied_at, { allowNull: true })
    if (repliedAt === undefined) return { error: 'Invalid replied_at timestamp.' }
    payload.replied_at = repliedAt
  }

  if ('created_at' in input) {
    const createdAt = sanitizeTimestamp(input.created_at)
    if (!createdAt) return { error: 'Invalid created_at timestamp.' }
    payload.created_at = createdAt
  }

  if ('updated_at' in input) {
    const updatedAt = sanitizeTimestamp(input.updated_at)
    if (!updatedAt) return { error: 'Invalid updated_at timestamp.' }
    payload.updated_at = updatedAt
  }

  if (action === 'insert' || action === 'upsert') {
    if (
      typeof payload.full_name !== 'string' ||
      typeof payload.email !== 'string' ||
      typeof payload.phone !== 'string' ||
      typeof payload.message !== 'string'
    ) {
      return { error: 'full_name, email, phone, and message are required for insert/upsert.' }
    }
  }

  return { value: payload }
}

function sanitizePayloadForTable(
  table: AdminTable,
  action: WriteAction,
  payload: unknown,
): SanitizationResult<Record<string, unknown> | Record<string, unknown>[]> {
  const sanitizeSingle = (input: unknown): SanitizationResult<Record<string, unknown>> => {
    if (!isRecord(input)) return { error: 'Payload must be an object.' }

    if (table === 'site_settings') {
      return sanitizeSiteSettingsPayload(action, input)
    }
    if (table === 'projects' || table === 'blog_posts') {
      return sanitizeCommonContentPayload(table, action, input)
    }
    return sanitizeContactMessagePayload(action, input)
  }

  if (Array.isArray(payload)) {
    if (action === 'update') {
      return { error: 'Update payload must be a single object.' }
    }

    if (payload.length === 0 || payload.length > MAX_BULK_ROWS) {
      return { error: `Bulk payload must contain 1-${MAX_BULK_ROWS} rows.` }
    }

    const normalizedRows: Record<string, unknown>[] = []
    for (let index = 0; index < payload.length; index += 1) {
      const rowResult = sanitizeSingle(payload[index])
      if (rowResult.error || !rowResult.value) {
        return { error: rowResult.error ? `Row ${index + 1}: ${rowResult.error}` : `Row ${index + 1} is invalid.` }
      }
      normalizedRows.push(rowResult.value)
    }

    return { value: normalizedRows }
  }

  return sanitizeSingle(payload)
}

function sanitizeOnConflict(table: AdminTable, onConflict: unknown): SanitizationResult<string> {
  if (onConflict === undefined || onConflict === null || onConflict === '') {
    return {}
  }

  if (typeof onConflict !== 'string') {
    return { error: 'Invalid onConflict value.' }
  }

  const columns = onConflict
    .split(',')
    .map((column) => column.trim())
    .filter(Boolean)

  if (columns.length === 0) {
    return { error: 'Invalid onConflict value.' }
  }

  const allowedColumns = TABLE_WRITE_COLUMNS[table]
  for (const column of columns) {
    if (!IDENTIFIER_PATTERN.test(column) || !allowedColumns.has(column)) {
      return { error: `Invalid onConflict column "${column}".` }
    }
  }

  return { value: columns.join(',') }
}

function toFilterValue(operator: FilterOperator, value: unknown): string {
  const stringify = (input: unknown): string => sanitizeText(String(input), 220)

  if (operator === 'is') {
    if (value === null) return 'is.null'
    return `is.${stringify(value).toLowerCase()}`
  }

  if (operator === 'in') {
    const values = Array.isArray(value) ? value : [value]
    const normalized = values
      .map((entry) => stringify(entry))
      .filter((entry) => entry.length > 0)
      .map((entry) => `"${entry.replace(/"/g, '\\"')}"`)
      .join(',')

    return `in.(${normalized})`
  }

  return `${operator}.${stringify(value)}`
}

function applyFilters(table: AdminTable, url: URL, filters: FilterInput[]): string | null {
  if (filters.length > MAX_FILTERS) {
    return `Too many filters. Maximum is ${MAX_FILTERS}.`
  }

  const allowedColumns = TABLE_FILTER_COLUMNS[table]

  for (const filter of filters) {
    const column = sanitizeText(filter.column, 64)
    const operator = filter.operator ?? 'eq'

    if (!IDENTIFIER_PATTERN.test(column) || !allowedColumns.has(column)) {
      return `Invalid filter column "${column || filter.column}".`
    }

    if (!ALLOWED_OPERATORS.has(operator)) {
      return `Invalid filter operator "${operator}".`
    }

    url.searchParams.set(column, toFilterValue(operator, filter.value))
  }

  return null
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
    namespace: 'admin-supabase-write',
    key: getClientIdentifier(request),
    maxRequests: 120,
    windowMs: 10 * 60 * 1000,
  })

  if (!rateLimit.allowed) {
    return jsonResponse(
      { error: 'Terlalu banyak permintaan. Silakan coba lagi beberapa saat lagi.' },
      429,
      { 'Retry-After': String(rateLimit.retryAfterSeconds) },
    )
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

  const body = await readJsonSafe<AdminWriteBody>(request)
  if (!body) {
    return jsonResponse({ error: 'Invalid JSON payload.' }, 400)
  }

  const table = sanitizeText(body.table, 40) as AdminWriteBody['table']
  if (!isAdminTable(table)) {
    return jsonResponse({ error: 'Table is not allowed for this endpoint.' }, 403)
  }

  const action = sanitizeText(body.action, 20) as WriteAction
  if (!ALLOWED_WRITE_ACTIONS.has(action)) {
    return jsonResponse({ error: 'Invalid write action.' }, 400)
  }

  if ((action === 'update' || action === 'delete') && (!Array.isArray(body.filters) || body.filters.length === 0)) {
    return jsonResponse({ error: 'Update/Delete requires at least one filter.' }, 400)
  }

  if ((action === 'insert' || action === 'update' || action === 'upsert') && body.payload === undefined) {
    return jsonResponse({ error: 'Payload is required for insert/update/upsert.' }, 400)
  }

  const endpoint = new URL(`${config.url}/rest/v1/${table}`)

  let sanitizedPayload: Record<string, unknown> | Record<string, unknown>[] | undefined
  if (action !== 'delete') {
    const payloadResult = sanitizePayloadForTable(table, action, body.payload)
    if (payloadResult.error || payloadResult.value === undefined) {
      return jsonResponse({ error: payloadResult.error ?? 'Invalid payload.' }, 400)
    }
    sanitizedPayload = payloadResult.value
  }

  if (action === 'upsert') {
    const conflictResult = sanitizeOnConflict(table, body.onConflict)
    if (conflictResult.error) {
      return jsonResponse({ error: conflictResult.error }, 400)
    }
    if (conflictResult.value) {
      endpoint.searchParams.set('on_conflict', conflictResult.value)
    }
  }

  if (Array.isArray(body.filters) && body.filters.length > 0) {
    const filterError = applyFilters(table, endpoint, body.filters)
    if (filterError) {
      return jsonResponse({ error: filterError }, 400)
    }
  }

  const method =
    action === 'insert' || action === 'upsert'
      ? 'POST'
      : action === 'update'
        ? 'PATCH'
        : 'DELETE'

  const prefer = action === 'upsert' ? 'resolution=merge-duplicates,return=representation' : 'return=representation'

  const response = await fetch(endpoint.toString(), {
    method,
    headers: {
      'Content-Type': 'application/json',
      apikey: config.anonKey,
      Authorization: `Bearer ${accessToken}`,
      Prefer: action === 'delete' ? 'return=minimal' : prefer,
    },
    body: action === 'delete' ? undefined : JSON.stringify(sanitizedPayload),
  })

  if (!response.ok) {
    if (response.status >= 500) {
      return jsonResponse({ error: 'Data service error. Please retry.' }, 502)
    }

    const errorMessage = import.meta.env.DEV
      ? await readResponseError(response, 'Admin write request failed.')
      : 'Write request was rejected by backend policy.'
    return jsonResponse({ error: errorMessage }, response.status)
  }

  if (action === 'delete') {
    return jsonResponse({ success: true }, 200)
  }

  const data = await readJsonSafe<unknown>(response)
  return jsonResponse({ success: true, data }, 200)
}
