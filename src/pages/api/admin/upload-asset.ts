import type { APIRoute } from 'astro'
import {
  consumeRateLimit,
  getClientIdentifier,
  hasPayloadTooLarge,
  isAllowedRequestOrigin,
  isTrustedFetchSite,
  hasValidCsrfToken,
  hasMultipartContentType,
  jsonResponse,
} from '@server/security/api-security'
import {
  getBearerToken,
  getSupabaseServerConfig,
  isAdminEmailAllowed,
  readResponseError,
  verifySupabaseAccessToken,
} from '@server/supabase/server'

const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const IMAGE_EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024
const MAX_REQUEST_BYTES = 8 * 1024 * 1024

function sanitizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function sanitizeFolderPath(value: string): string {
  return value
    .split('/')
    .map((segment) => sanitizeName(segment))
    .filter(Boolean)
    .join('/')
}

function getExtension(fileName: string, mimeType: string): string {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)
  const normalizedExtension = match ? match[1] : ''
  const normalizedMime = mimeType.toLowerCase()
  const expectedExtension = IMAGE_EXTENSION_BY_MIME[normalizedMime] ?? ''

  if (normalizedExtension && normalizedExtension === expectedExtension) {
    return normalizedExtension
  }

  return expectedExtension || 'bin'
}

function encodeObjectPath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

function detectImageMime(signature: Uint8Array): string | null {
  if (
    signature.length >= 8 &&
    signature[0] === 0x89 &&
    signature[1] === 0x50 &&
    signature[2] === 0x4e &&
    signature[3] === 0x47 &&
    signature[4] === 0x0d &&
    signature[5] === 0x0a &&
    signature[6] === 0x1a &&
    signature[7] === 0x0a
  ) {
    return 'image/png'
  }

  if (signature.length >= 3 && signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff) {
    return 'image/jpeg'
  }

  if (
    signature.length >= 12 &&
    signature[0] === 0x52 &&
    signature[1] === 0x49 &&
    signature[2] === 0x46 &&
    signature[3] === 0x46 &&
    signature[8] === 0x57 &&
    signature[9] === 0x45 &&
    signature[10] === 0x42 &&
    signature[11] === 0x50
  ) {
    return 'image/webp'
  }

  if (
    signature.length >= 6 &&
    signature[0] === 0x47 &&
    signature[1] === 0x49 &&
    signature[2] === 0x46 &&
    signature[3] === 0x38 &&
    (signature[4] === 0x37 || signature[4] === 0x39) &&
    signature[5] === 0x61
  ) {
    return 'image/gif'
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

  if (!hasMultipartContentType(request)) {
    return jsonResponse({ error: 'Content-Type harus multipart/form-data.' }, 415)
  }

  if (hasPayloadTooLarge(request, MAX_REQUEST_BYTES)) {
    return jsonResponse({ error: 'Ukuran data melebihi batas.' }, 413)
  }

  const rateLimit = consumeRateLimit({
    namespace: 'admin-upload-asset',
    key: getClientIdentifier(request),
    maxRequests: 40,
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

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return jsonResponse({ error: 'Invalid multipart form-data.' }, 400)
  }

  const inputFile = formData.get('file')
  if (!(inputFile instanceof File)) {
    return jsonResponse({ error: 'Field "file" is required.' }, 400)
  }

  if (!ALLOWED_IMAGE_MIME_TYPES.has((inputFile.type || '').toLowerCase())) {
    return jsonResponse({ error: 'Unsupported image format. Use PNG, JPG, WEBP, or GIF.' }, 400)
  }

  if (inputFile.size > MAX_UPLOAD_BYTES) {
    return jsonResponse({ error: 'File too large. Maximum upload size is 5MB.' }, 400)
  }

  const fileType = inputFile.type.toLowerCase()
  let detectedMime: string | null = null
  try {
    const signatureBuffer = await inputFile.slice(0, 16).arrayBuffer()
    detectedMime = detectImageMime(new Uint8Array(signatureBuffer))
  } catch {
    return jsonResponse({ error: 'Unable to read uploaded file.' }, 400)
  }

  if (!detectedMime || detectedMime !== fileType) {
    return jsonResponse({ error: 'File content does not match declared MIME type.' }, 400)
  }

  const folderInput = String(formData.get('folder') ?? '').trim()
  const folder = sanitizeFolderPath(folderInput || 'uploads')
  const bucket = config.assetsBucket

  const baseFileName = String(formData.get('fileName') ?? inputFile.name ?? 'asset').trim() || 'asset'
  const ext = getExtension(baseFileName, fileType)
  const rawBaseName = baseFileName.replace(/\.[^/.]+$/, '')
  const safeBaseName = sanitizeName(rawBaseName) || 'asset'
  const objectPath = `${folder}/${Date.now()}-${crypto.randomUUID()}-${safeBaseName}.${ext}`
  const encodedPath = encodeObjectPath(objectPath)

  const uploadResponse = await fetch(`${config.url}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`, {
    method: 'POST',
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': fileType || 'application/octet-stream',
      'x-upsert': 'false',
      'cache-control': '31536000',
    },
    body: inputFile,
  })

  if (!uploadResponse.ok) {
    const errorMessage = await readResponseError(uploadResponse, 'Failed to upload asset.')
    return jsonResponse({ error: errorMessage }, uploadResponse.status)
  }

  const publicUrl = `${config.url}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodedPath}`
  return jsonResponse(
    {
      success: true,
      publicUrl,
      filePath: objectPath,
      bucket,
    },
    200,
  )
}
