import { slugify } from '@utils/slugify'

export interface ContentParagraphBlock {
  id: string
  type: 'paragraph'
  text: string
}

export interface ContentImageBlock {
  id: string
  type: 'image'
  url: string
  alt: string
  caption: string
}

export interface ContentTableBlock {
  id: string
  type: 'table'
  caption: string
  headers: string[]
  rows: string[][]
}

export type ContentBlock = ContentParagraphBlock | ContentImageBlock | ContentTableBlock

export interface SupabaseContentRow {
  id: string
  slug: string | null
  title: string | null
  author: string | null
  description: string | null
  tags: string[] | string | null
  body: string | null
  cover_image_url?: string | null
  content_blocks?: unknown
  created_at: string | null
}

export interface NormalizedContentEntity {
  id: string
  slug: string
  title: string
  author: string
  description: string
  tags: string[]
  body: string
  coverImageUrl: string | null
  contentBlocks: ContentBlock[]
  createdAt: string | null
}

interface NormalizeEntityOptions {
  fallbackTitle: string
}

interface FetchSupabaseRowsOptions {
  table: string
  latestSelect: string
  legacySelect: string
  fetchFailureMessage: string
  fetchErrorMessage: string
  orderBy?: string
  limit?: number
  offset?: number
  filters?: FetchFilter[]
  cacheTtlMs?: number
}

type FetchFilterOperator = 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte' | 'like' | 'ilike' | 'is' | 'in' | 'cs' | 'ov'

interface FetchFilter {
  column: string
  operator?: FetchFilterOperator
  value: unknown
}

interface CachedRows {
  data: unknown[]
  expiresAt: number
  totalCount: number | null
}

export interface FetchSupabaseRowsResult<Row> {
  rows: Row[]
  totalCount: number | null
}

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY
const supabaseAssetsBucket = import.meta.env.PUBLIC_SUPABASE_ASSETS_BUCKET ?? 'site-assets'
const supabaseFetchDisabledEnv =
  import.meta.env.PUBLIC_SUPABASE_FETCH_DISABLED ??
  import.meta.env.SUPABASE_FETCH_DISABLED ??
  (typeof process !== 'undefined' ? process.env.SUPABASE_FETCH_DISABLED : undefined)
const isSupabaseFetchDisabled = supabaseFetchDisabledEnv === '1' || supabaseFetchDisabledEnv === 'true'
const supabaseStoragePublicBase = supabaseUrl
  ? `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${supabaseAssetsBucket}/`
  : ''
const supabaseCacheTtlEnv =
  import.meta.env.PUBLIC_SUPABASE_CONTENT_CACHE_TTL_MS ??
  import.meta.env.SUPABASE_CONTENT_CACHE_TTL_MS ??
  (typeof process !== 'undefined' ? process.env.SUPABASE_CONTENT_CACHE_TTL_MS : undefined)
const defaultCacheTtlMs = Math.max(0, Number.parseInt(String(supabaseCacheTtlEnv ?? '30000'), 10) || 30000)
const MAX_CACHE_ENTRIES = 200
const filterOperatorSet = new Set<FetchFilterOperator>([
  'eq',
  'neq',
  'lt',
  'lte',
  'gt',
  'gte',
  'like',
  'ilike',
  'is',
  'in',
  'cs',
  'ov',
])
const responseCache = new Map<string, CachedRows>()
const inFlightRequests = new Map<string, Promise<CachedRows | null>>()

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey) && !isSupabaseFetchDisabled

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function pruneExpiredCache(now: number): void {
  for (const [key, entry] of responseCache.entries()) {
    if (entry.expiresAt <= now) {
      responseCache.delete(key)
    }
  }

  if (responseCache.size <= MAX_CACHE_ENTRIES) {
    return
  }

  const overflow = responseCache.size - MAX_CACHE_ENTRIES
  const keys = [...responseCache.keys()]
  for (let index = 0; index < overflow; index += 1) {
    const key = keys[index]
    if (key) {
      responseCache.delete(key)
    }
  }
}

function toFilterValue(operator: FetchFilterOperator, value: unknown): string {
  if (operator === 'is') {
    if (value === null) return 'is.null'
    return `is.${String(value).toLowerCase()}`
  }

  if (operator === 'in' || operator === 'cs' || operator === 'ov') {
    const values = Array.isArray(value) ? value : [value]
    const normalized = values
      .map((entry) => String(entry).trim())
      .filter((entry) => entry.length > 0)
      .map((entry) => `"${entry.replace(/"/g, '\\"')}"`)
      .join(',')

    if (operator === 'in') {
      return `in.(${normalized})`
    }

    return `${operator}.{${normalized}}`
  }

  return `${operator}.${String(value)}`
}

function applyFilters(endpoint: URL, filters: FetchFilter[] | undefined): void {
  if (!Array.isArray(filters) || filters.length === 0) {
    return
  }

  for (const filter of filters) {
    const column = asString(filter.column)
    if (!column) continue

    const operator = filter.operator ?? 'eq'
    if (!filterOperatorSet.has(operator)) continue

    endpoint.searchParams.set(column, toFilterValue(operator, filter.value))
  }
}

function parseTotalCount(value: string | null): number | null {
  if (!value) return null

  const slashIndex = value.lastIndexOf('/')
  if (slashIndex < 0) return null

  const rawCount = value.slice(slashIndex + 1).trim()
  if (!rawCount || rawCount === '*') return null

  const parsed = Number.parseInt(rawCount, 10)
  return Number.isFinite(parsed) ? parsed : null
}

export function normalizeTags(tags: string[] | string | null | undefined): string[] {
  if (Array.isArray(tags)) {
    return tags.map((tag) => String(tag).trim()).filter(Boolean)
  }

  if (typeof tags === 'string') {
    return tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)
  }

  return []
}

export function normalizeAssetUrl(rawUrl: unknown): string {
  const value = asString(rawUrl)
  if (!value) return ''
  const lowerValue = value.toLowerCase()

  if (
    lowerValue.startsWith('javascript:') ||
    lowerValue.startsWith('vbscript:') ||
    lowerValue.startsWith('file:') ||
    lowerValue.startsWith('data:') ||
    lowerValue.startsWith('blob:')
  ) {
    return ''
  }

  if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('/')) {
    return value
  }

  if (!supabaseStoragePublicBase || !supabaseUrl) {
    return value
  }

  const normalizedHost = supabaseUrl.replace(/\/$/, '')

  if (value.startsWith('storage/v1/object/public/')) {
    return `${normalizedHost}/${value}`
  }

  if (value.startsWith(`${supabaseAssetsBucket}/`)) {
    return `${normalizedHost}/storage/v1/object/public/${value}`
  }

  return `${supabaseStoragePublicBase}${value.replace(/^\/+/, '')}`
}

export function normalizeContentBlocks(raw: unknown): ContentBlock[] {
  let source: unknown = raw

  if (typeof source === 'string') {
    const trimmed = source.trim()
    if (!trimmed) return []
    try {
      source = JSON.parse(trimmed)
    } catch {
      return []
    }
  }

  if (isRecord(source) && Array.isArray(source.blocks)) {
    source = source.blocks
  }

  if (!Array.isArray(source)) {
    return []
  }

  const blocks: ContentBlock[] = []

  source.forEach((entry, index) => {
    if (!isRecord(entry)) return

    const id = asString(entry.id) || `block-${index + 1}`
    const type = asString(entry.type)

    if (type === 'paragraph') {
      const text = asString(entry.text)
      if (!text) return
      blocks.push({
        id,
        type: 'paragraph',
        text,
      })
      return
    }

    if (type === 'image') {
      const url = asString(entry.url) || asString(entry.src) || asString(entry.image_url)
      if (!url) return
      blocks.push({
        id,
        type: 'image',
        url: normalizeAssetUrl(url),
        alt: asString(entry.alt),
        caption: asString(entry.caption),
      })
      return
    }

    if (type === 'table') {
      const headers = Array.isArray(entry.headers) ? entry.headers.map(asString).filter(Boolean) : []
      const rows = Array.isArray(entry.rows)
        ? entry.rows
            .map((row) => (Array.isArray(row) ? row.map(asString).filter((cell) => cell.length > 0) : []))
            .filter((row) => row.length > 0)
        : []

      if (headers.length === 0 && rows.length === 0) return

      blocks.push({
        id,
        type: 'table',
        caption: asString(entry.caption),
        headers,
        rows,
      })
    }
  })

  return blocks
}

export function normalizeSupabaseContentEntity(
  row: SupabaseContentRow,
  options: NormalizeEntityOptions,
): NormalizedContentEntity {
  const fallbackTitle = row.title?.trim() || options.fallbackTitle
  const fallbackSlug = row.slug?.trim() || slugify(fallbackTitle || row.id)

  return {
    id: row.id,
    slug: fallbackSlug,
    title: fallbackTitle,
    author: row.author?.trim() || 'Unknown author',
    description: row.description?.trim() || '',
    tags: normalizeTags(row.tags),
    body: row.body ?? '',
    coverImageUrl: normalizeAssetUrl(row.cover_image_url) || null,
    contentBlocks: normalizeContentBlocks(row.content_blocks),
    createdAt: row.created_at ?? null,
  }
}

async function fetchSupabaseRowsInternal<Row>(
  options: FetchSupabaseRowsOptions,
  includeCount: boolean,
): Promise<FetchSupabaseRowsResult<Row>> {
  if (isSupabaseFetchDisabled || !isSupabaseConfigured || !supabaseUrl || !supabaseAnonKey) {
    return { rows: [], totalCount: 0 }
  }

  try {
    const baseUrl = supabaseUrl
    const anonKey = supabaseAnonKey
    const effectiveOrder = asString(options.orderBy) || 'created_at.desc'
    const rawLimit = Number.parseInt(String(options.limit ?? ''), 10)
    const effectiveLimit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 1000) : null
    const rawOffset = Number.parseInt(String(options.offset ?? ''), 10)
    const effectiveOffset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : null
    const cacheTtlMs = Math.max(0, options.cacheTtlMs ?? defaultCacheTtlMs)

    const fetchRows = async (selectClause: string): Promise<FetchSupabaseRowsResult<Row> | null> => {
      const endpoint = new URL(`/rest/v1/${options.table}`, baseUrl)
      endpoint.searchParams.set('select', selectClause)
      endpoint.searchParams.set('order', effectiveOrder)
      if (effectiveLimit) {
        endpoint.searchParams.set('limit', String(effectiveLimit))
      }
      if (effectiveOffset !== null) {
        endpoint.searchParams.set('offset', String(effectiveOffset))
      }
      applyFilters(endpoint, options.filters)

      const requestUrl = endpoint.toString()
      const requestKey = `${requestUrl}|count=${includeCount ? 'exact' : 'none'}`
      const now = Date.now()

      if (cacheTtlMs > 0) {
        pruneExpiredCache(now)
        const cached = responseCache.get(requestKey)
        if (cached && cached.expiresAt > now) {
          return {
            rows: cached.data as Row[],
            totalCount: cached.totalCount,
          }
        }
      }

      const inFlight = inFlightRequests.get(requestKey)
      if (inFlight) {
        const cached = await inFlight
        return cached
          ? {
              rows: cached.data as Row[],
              totalCount: cached.totalCount,
            }
          : null
      }

      const requestPromise = (async (): Promise<CachedRows | null> => {
        const response = await fetch(requestUrl, {
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${anonKey}`,
            ...(includeCount ? { Prefer: 'count=exact' } : {}),
          },
        })

        if (!response.ok) {
          return null
        }

        const data = (await response.json()) as Row[]
        const normalized = Array.isArray(data) ? data : []
        const cachedRows: CachedRows = {
          data: normalized,
          expiresAt: Date.now() + cacheTtlMs,
          totalCount: includeCount ? parseTotalCount(response.headers.get('content-range')) : null,
        }

        if (cacheTtlMs > 0) {
          responseCache.set(requestKey, cachedRows)
        }

        return cachedRows
      })()

      inFlightRequests.set(requestKey, requestPromise)
      try {
        const cached = await requestPromise
        return cached
          ? {
              rows: cached.data as Row[],
              totalCount: cached.totalCount,
            }
          : null
      } finally {
        inFlightRequests.delete(requestKey)
      }
    }

    const latestRows = await fetchRows(options.latestSelect)
    if (latestRows) {
      return latestRows
    }

    const legacyRows = await fetchRows(options.legacySelect)
    if (legacyRows) {
      return legacyRows
    }

    console.warn(options.fetchFailureMessage)
    return { rows: [], totalCount: 0 }
  } catch (error) {
    console.warn(options.fetchErrorMessage, error)
    return { rows: [], totalCount: 0 }
  }
}

export async function fetchSupabaseRows<Row>(options: FetchSupabaseRowsOptions): Promise<Row[]> {
  const result = await fetchSupabaseRowsInternal<Row>(options, false)
  return result.rows
}

export async function fetchSupabaseRowsWithCount<Row>(
  options: FetchSupabaseRowsOptions,
): Promise<FetchSupabaseRowsResult<Row>> {
  return fetchSupabaseRowsInternal<Row>(options, true)
}
