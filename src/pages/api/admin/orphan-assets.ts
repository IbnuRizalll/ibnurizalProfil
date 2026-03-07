import type { APIRoute } from 'astro'
import {
  consumeRateLimit,
  getClientIdentifier,
  hasPayloadTooLarge,
  hasValidCsrfToken,
  isAllowedRequestOrigin,
  isTrustedFetchSite,
  hasJsonContentType,
  jsonResponse,
} from '@utils/api-security'
import {
  getBearerToken,
  getSupabaseServerConfig,
  isAdminEmailAllowed,
  readJsonSafe,
  readResponseError,
  verifySupabaseAccessToken,
} from '@utils/supabase-server'
import { getPrismaServerClient } from '@utils/prisma-server'

type AdminAssetAction = 'scan' | 'delete'

interface AdminAssetBody {
  action?: AdminAssetAction
  paths?: unknown
}

interface PublicContentRow {
  cover_image_url?: unknown
  content_blocks?: unknown
}

interface SiteSettingsRow {
  logo_url?: unknown
  home_image_url?: unknown
}

interface StorageObjectRow {
  id?: unknown
  name?: unknown
  metadata?: unknown
  created_at?: unknown
  updated_at?: unknown
}

interface StorageObjectEntry {
  path: string
  sizeBytes: number
  createdAt: string | null
  updatedAt: string | null
}

const MAX_REQUEST_BYTES = 128 * 1024
const MAX_SCAN_OBJECTS = 12_000
const MAX_SCAN_RESPONSE_ITEMS = 1_500
const MAX_DELETE_ITEMS = 250
const REST_PAGE_LIMIT = 1_000
const STORAGE_LIST_PAGE_LIMIT = 100

function isStorageSchemaError(input: unknown): boolean {
  const message = String(input ?? '').toLowerCase()
  return (
    message.includes('invalid schema: storage') ||
    (message.includes('schema') && message.includes('storage') && message.includes('must be one of'))
  )
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeStoragePath(value: string): string | null {
  const normalized = value
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join('/')

  if (!normalized) return null
  if (normalized.includes('\u0000')) return null

  const segments = normalized.split('/')
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return null
  }

  return normalized.slice(0, 900)
}

function decodeUriComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function encodeObjectPath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

function extractBucketAssetPath(rawValue: unknown, bucket: string): string | null {
  const raw = asString(rawValue)
  if (!raw) return null

  const lowered = raw.toLowerCase()
  if (
    lowered.startsWith('data:') ||
    lowered.startsWith('blob:') ||
    lowered.startsWith('javascript:') ||
    lowered.startsWith('vbscript:')
  ) {
    return null
  }

  const markers = [`/storage/v1/object/public/${bucket}/`, `storage/v1/object/public/${bucket}/`]

  const extractFromPath = (inputPath: string): string | null => {
    const decodedPath = decodeUriComponentSafe(inputPath)

    for (const marker of markers) {
      const markerIndex = decodedPath.indexOf(marker)
      if (markerIndex >= 0) {
        const candidate = decodedPath.slice(markerIndex + marker.length)
        return normalizeStoragePath(candidate)
      }
    }

    if (decodedPath.startsWith(`${bucket}/`)) {
      return normalizeStoragePath(decodedPath.slice(bucket.length + 1))
    }

    return null
  }

  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    try {
      const parsed = new URL(raw)
      return extractFromPath(parsed.pathname)
    } catch {
      return null
    }
  }

  return extractFromPath(raw)
}

function collectAssetPathsFromContentBlocks(rawContentBlocks: unknown, bucket: string, result: Set<string>): void {
  let source: unknown = rawContentBlocks
  if (typeof source === 'string') {
    const trimmed = source.trim()
    if (!trimmed) return
    try {
      source = JSON.parse(trimmed)
    } catch {
      return
    }
  }

  if (typeof source === 'object' && source !== null && !Array.isArray(source)) {
    const blocks = (source as { blocks?: unknown }).blocks
    if (Array.isArray(blocks)) {
      source = blocks
    }
  }

  if (!Array.isArray(source)) return

  for (const block of source) {
    if (!block || typeof block !== 'object' || Array.isArray(block)) continue
    const blockType = asString((block as { type?: unknown }).type).toLowerCase()
    if (blockType !== 'image') continue
    const blockUrl = (block as { url?: unknown }).url
    const objectPath = extractBucketAssetPath(blockUrl, bucket)
    if (objectPath) {
      result.add(objectPath)
    }
  }
}

function parseStorageObjectSize(metadata: unknown): number {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return 0
  }
  const rawSize = (metadata as { size?: unknown }).size
  if (typeof rawSize === 'number' && Number.isFinite(rawSize) && rawSize >= 0) {
    return rawSize
  }
  if (typeof rawSize === 'string') {
    const parsed = Number.parseInt(rawSize, 10)
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed
    }
  }
  return 0
}

async function fetchPublicRows<Row>(
  supabaseUrl: string,
  anonKey: string,
  accessToken: string,
  table: string,
  select: string,
): Promise<Row[]> {
  const result: Row[] = []
  let offset = 0

  while (result.length < MAX_SCAN_OBJECTS) {
    const endpoint = new URL(`${supabaseUrl}/rest/v1/${table}`)
    endpoint.searchParams.set('select', select)
    endpoint.searchParams.set('limit', String(REST_PAGE_LIMIT))
    endpoint.searchParams.set('offset', String(offset))

    const response = await fetch(endpoint.toString(), {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      throw new Error(await readResponseError(response, `Failed to read ${table}.`))
    }

    const pageRows = (await readJsonSafe<unknown[]>(response)) ?? []
    if (!Array.isArray(pageRows) || pageRows.length === 0) break

    result.push(...(pageRows as Row[]))
    if (pageRows.length < REST_PAGE_LIMIT) break

    offset += pageRows.length
  }

  return result
}

async function fetchStorageObjectsViaDatabase(bucket: string): Promise<StorageObjectEntry[]> {
  const prisma = getPrismaServerClient()
  const rows = await prisma.$queryRaw<
    Array<{
      name: string | null
      metadata: unknown
      created_at: Date | string | null
      updated_at: Date | string | null
    }>
  >`
    select name, metadata, created_at, updated_at
    from storage.objects
    where bucket_id = ${bucket}
    order by name asc
    limit ${MAX_SCAN_OBJECTS}
  `

  return rows
    .map((row) => {
      const path = normalizeStoragePath(asString(row?.name))
      if (!path) return null

      const normalizeDate = (value: Date | string | null): string | null => {
        if (!value) return null
        if (value instanceof Date) return value.toISOString()
        const text = asString(value)
        return text || null
      }

      return {
        path,
        sizeBytes: parseStorageObjectSize(row?.metadata),
        createdAt: normalizeDate(row?.created_at),
        updatedAt: normalizeDate(row?.updated_at),
      } satisfies StorageObjectEntry
    })
    .filter((entry): entry is StorageObjectEntry => entry !== null)
}

async function fetchStorageObjects(
  supabaseUrl: string,
  anonKey: string,
  accessToken: string,
  bucket: string,
): Promise<StorageObjectEntry[]> {
  const result: StorageObjectEntry[] = []
  const queue: string[] = ['']
  const visitedPrefixes = new Set<string>()

  while (queue.length > 0 && result.length < MAX_SCAN_OBJECTS) {
    const prefix = queue.shift() ?? ''
    if (visitedPrefixes.has(prefix)) continue
    visitedPrefixes.add(prefix)

    let offset = 0
    while (result.length < MAX_SCAN_OBJECTS) {
      const endpoint = `${supabaseUrl}/storage/v1/object/list/${encodeURIComponent(bucket)}`
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: anonKey,
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          limit: STORAGE_LIST_PAGE_LIMIT,
          offset,
          prefix,
          sortBy: { column: 'name', order: 'asc' },
        }),
      })

      if (!response.ok) {
        throw new Error(await readResponseError(response, 'Failed to read storage objects.'))
      }

      const pageRows = (await readJsonSafe<StorageObjectRow[]>(response)) ?? []
      if (!Array.isArray(pageRows) || pageRows.length === 0) break

      for (const row of pageRows) {
        const name = normalizeStoragePath(asString(row?.name))
        if (!name) continue

        const rawId = asString(row?.id)
        const hasObjectId = rawId.length > 0
        const filePath = normalizeStoragePath(prefix ? `${prefix}/${name}` : name)
        if (!filePath) continue

        if (hasObjectId) {
          result.push({
            path: filePath,
            sizeBytes: parseStorageObjectSize(row?.metadata),
            createdAt: asString(row?.created_at) || null,
            updatedAt: asString(row?.updated_at) || null,
          })
          if (result.length >= MAX_SCAN_OBJECTS) break
          continue
        }

        if (!visitedPrefixes.has(filePath)) {
          queue.push(filePath)
        }
      }

      if (result.length >= MAX_SCAN_OBJECTS) break
      if (pageRows.length < STORAGE_LIST_PAGE_LIMIT) break
      offset += pageRows.length
    }
  }

  return result
}

async function fetchStorageObjectsWithFallback(
  supabaseUrl: string,
  anonKey: string,
  accessToken: string,
  bucket: string,
): Promise<StorageObjectEntry[]> {
  try {
    return await fetchStorageObjects(supabaseUrl, anonKey, accessToken, bucket)
  } catch (error) {
    if (!isStorageSchemaError(error instanceof Error ? error.message : error)) {
      throw error
    }

    if (import.meta.env.DEV) {
      console.warn('[admin/orphan-assets] Falling back to direct database query for storage.objects.')
    }
    return fetchStorageObjectsViaDatabase(bucket)
  }
}

async function fetchReferencedAssetPaths(
  supabaseUrl: string,
  anonKey: string,
  accessToken: string,
  bucket: string,
): Promise<Set<string>> {
  const referenced = new Set<string>()

  const [siteSettingsRows, projectRows, blogRows] = await Promise.all([
    fetchPublicRows<SiteSettingsRow>(supabaseUrl, anonKey, accessToken, 'site_settings', 'logo_url,home_image_url'),
    fetchPublicRows<PublicContentRow>(supabaseUrl, anonKey, accessToken, 'projects', 'cover_image_url,content_blocks'),
    fetchPublicRows<PublicContentRow>(supabaseUrl, anonKey, accessToken, 'blog_posts', 'cover_image_url,content_blocks'),
  ])

  for (const row of siteSettingsRows) {
    const logoPath = extractBucketAssetPath(row.logo_url, bucket)
    const homeImagePath = extractBucketAssetPath(row.home_image_url, bucket)
    if (logoPath) referenced.add(logoPath)
    if (homeImagePath) referenced.add(homeImagePath)
  }

  const collectFromRows = (rows: PublicContentRow[]) => {
    for (const row of rows) {
      const coverPath = extractBucketAssetPath(row.cover_image_url, bucket)
      if (coverPath) {
        referenced.add(coverPath)
      }
      collectAssetPathsFromContentBlocks(row.content_blocks, bucket, referenced)
    }
  }

  collectFromRows(projectRows)
  collectFromRows(blogRows)

  return referenced
}

async function deleteStorageObject(
  supabaseUrl: string,
  anonKey: string,
  accessToken: string,
  bucket: string,
  path: string,
): Promise<{ ok: boolean; error?: string }> {
  const encodedPath = encodeObjectPath(path)
  const endpoint = `${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`

  const response = await fetch(endpoint, {
    method: 'DELETE',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (response.ok) {
    return { ok: true }
  }

  const apiError = await readResponseError(response, `Failed to delete "${path}".`)
  if (isStorageSchemaError(apiError)) {
    try {
      const prisma = getPrismaServerClient()
      const affectedRows = await prisma.$executeRaw`
        delete from storage.objects
        where bucket_id = ${bucket}
          and name = ${path}
      `

      if (affectedRows > 0) {
        return { ok: true }
      }

      return { ok: false, error: `File "${path}" not found in storage metadata.` }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : `Failed to delete "${path}" via database fallback.`,
      }
    }
  }

  return {
    ok: false,
    error: apiError,
  }
}

function sortOrphansByDateDesc(entries: StorageObjectEntry[]): StorageObjectEntry[] {
  return [...entries].sort((left, right) => {
    const leftDate = Date.parse(left.updatedAt || left.createdAt || '')
    const rightDate = Date.parse(right.updatedAt || right.createdAt || '')
    if (Number.isNaN(leftDate) && Number.isNaN(rightDate)) return 0
    if (Number.isNaN(leftDate)) return 1
    if (Number.isNaN(rightDate)) return -1
    return rightDate - leftDate
  })
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
    namespace: 'admin-orphan-assets',
    key: getClientIdentifier(request),
    maxRequests: 24,
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

  const body = await readJsonSafe<AdminAssetBody>(request)
  if (!body || typeof body !== 'object') {
    return jsonResponse({ error: 'Invalid JSON payload.' }, 400)
  }

  const action: AdminAssetAction = body.action === 'delete' ? 'delete' : 'scan'

  try {
    const [storageObjects, referencedPaths] = await Promise.all([
      fetchStorageObjectsWithFallback(config.url, config.anonKey, accessToken, config.assetsBucket),
      fetchReferencedAssetPaths(config.url, config.anonKey, accessToken, config.assetsBucket),
    ])

    const orphanEntries = storageObjects.filter((entry) => !referencedPaths.has(entry.path))
    const sortedOrphans = sortOrphansByDateDesc(orphanEntries)

    const totalStorageBytes = storageObjects.reduce((sum, entry) => sum + entry.sizeBytes, 0)
    const orphanBytes = orphanEntries.reduce((sum, entry) => sum + entry.sizeBytes, 0)

    if (action === 'scan') {
      return jsonResponse(
        {
          success: true,
          bucket: config.assetsBucket,
          summary: {
            totalObjects: storageObjects.length,
            referencedObjects: storageObjects.length - orphanEntries.length,
            orphanObjects: orphanEntries.length,
            totalStorageBytes,
            orphanBytes,
            maxScanObjects: MAX_SCAN_OBJECTS,
          },
          truncated: sortedOrphans.length > MAX_SCAN_RESPONSE_ITEMS,
          orphans: sortedOrphans.slice(0, MAX_SCAN_RESPONSE_ITEMS),
        },
        200,
      )
    }

    const rawPaths = Array.isArray(body.paths) ? body.paths : []
    if (rawPaths.length === 0) {
      return jsonResponse({ error: 'Pilih minimal satu file untuk dihapus.' }, 400)
    }

    if (rawPaths.length > MAX_DELETE_ITEMS) {
      return jsonResponse({ error: `Maksimum ${MAX_DELETE_ITEMS} file per hapus batch.` }, 400)
    }

    const requestedPaths = [
      ...new Set(
        rawPaths
          .map((entry) => normalizeStoragePath(asString(entry)))
          .filter((entry): entry is string => Boolean(entry)),
      ),
    ]

    if (requestedPaths.length === 0) {
      return jsonResponse({ error: 'Path file tidak valid.' }, 400)
    }

    const orphanPathSet = new Set(sortedOrphans.map((entry) => entry.path))
    const skippedReferenced: string[] = []
    const skippedMissing: string[] = []
    const deletionTargets: string[] = []

    for (const path of requestedPaths) {
      if (referencedPaths.has(path)) {
        skippedReferenced.push(path)
        continue
      }
      if (!orphanPathSet.has(path)) {
        skippedMissing.push(path)
        continue
      }
      deletionTargets.push(path)
    }

    const deleted: string[] = []
    const failed: Array<{ path: string; error: string }> = []

    for (const path of deletionTargets) {
      const deletionResult = await deleteStorageObject(config.url, config.anonKey, accessToken, config.assetsBucket, path)
      if (deletionResult.ok) {
        deleted.push(path)
      } else {
        failed.push({ path, error: deletionResult.error || 'Delete failed.' })
      }
    }

    return jsonResponse(
      {
        success: failed.length === 0,
        bucket: config.assetsBucket,
        deletedCount: deleted.length,
        requestedCount: requestedPaths.length,
        deleted,
        skippedReferenced,
        skippedMissing,
        failed,
      },
      failed.length > 0 ? 207 : 200,
    )
  } catch (error) {
    if (import.meta.env.DEV && error instanceof Error) {
      console.error('[admin/orphan-assets]', error)
      return jsonResponse({ error: error.message }, 502)
    }
    return jsonResponse({ error: 'Gagal memproses orphan files saat ini.' }, 502)
  }
}
