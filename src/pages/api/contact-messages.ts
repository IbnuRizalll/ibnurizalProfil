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
} from '@utils/api-security'
import { getSupabaseServerConfig, readResponseError } from '@utils/supabase-server'

interface ContactPayload {
  full_name: string
  email: string
  phone: string
  message: string
  website?: string
  is_read: boolean
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i
const PHONE_PATTERN = /^\+?[0-9()\s.-]{8,20}$/
const MIN_MESSAGE_LENGTH = 10
const MAX_MESSAGE_LENGTH = 2000
const MAX_NAME_LENGTH = 120
const MAX_REQUEST_BYTES = 16 * 1024
const DEDUP_WINDOW_MS = 2 * 60 * 1000
const DEDUP_MAX_KEYS = 5000
const dedupStore = new Map<string, number>()

function sanitizeInputText(value: unknown, maxLength: number, allowNewLines = false): string {
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

function normalizeForDedup(value: string): string {
  return String(value).trim().toLowerCase().replace(/\s+/g, ' ')
}

function pruneDedupStore(now: number): void {
  for (const [key, expiresAt] of dedupStore.entries()) {
    if (expiresAt <= now) {
      dedupStore.delete(key)
    }
  }

  if (dedupStore.size <= DEDUP_MAX_KEYS) {
    return
  }

  const overflow = dedupStore.size - DEDUP_MAX_KEYS
  const keys = [...dedupStore.keys()]
  for (let index = 0; index < overflow; index += 1) {
    const key = keys[index]
    if (key) dedupStore.delete(key)
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

  const clientIdentifier = getClientIdentifier(request)
  const rateLimit = consumeRateLimit({
    namespace: 'contact-messages',
    key: clientIdentifier,
    maxRequests: 8,
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
    return jsonResponse({ error: 'Layanan pesan belum tersedia saat ini.' }, 503)
  }

  let body: Partial<ContactPayload> | null = null
  try {
    body = (await request.json()) as Partial<ContactPayload>
  } catch {
    return jsonResponse({ error: 'Format data tidak valid.' }, 400)
  }

  const fullName = sanitizeInputText(body?.full_name, MAX_NAME_LENGTH)
  const email = sanitizeInputText(body?.email, 180).toLowerCase()
  const phone = sanitizeInputText(body?.phone, 24)
  const message = sanitizeInputText(body?.message, MAX_MESSAGE_LENGTH, true)
  const website = sanitizeInputText(body?.website, 320)

  // Honeypot field: if populated, silently accept and drop to reduce spam noise.
  if (website.length > 0) {
    return jsonResponse({ success: true }, 202)
  }

  if (!fullName || !email || !phone || !message) {
    return jsonResponse({ error: 'Nama, email, nomor, dan pesan wajib diisi.' }, 400)
  }

  if (fullName.length > MAX_NAME_LENGTH) {
    return jsonResponse({ error: 'Nama terlalu panjang.' }, 400)
  }

  if (!EMAIL_PATTERN.test(email)) {
    return jsonResponse({ error: 'Format email tidak valid.' }, 400)
  }

  if (!PHONE_PATTERN.test(phone)) {
    return jsonResponse({ error: 'Format nomor tidak valid.' }, 400)
  }

  if (message.length < MIN_MESSAGE_LENGTH || message.length > MAX_MESSAGE_LENGTH) {
    return jsonResponse({ error: 'Panjang pesan tidak sesuai batas.' }, 400)
  }

  const payload: ContactPayload = {
    full_name: fullName,
    email,
    phone,
    message,
    is_read: false,
  }

  const now = Date.now()
  pruneDedupStore(now)
  const dedupKey = [
    clientIdentifier,
    normalizeForDedup(fullName),
    normalizeForDedup(email),
    normalizeForDedup(phone),
    normalizeForDedup(message),
  ].join('|')

  const dedupUntil = dedupStore.get(dedupKey)
  if (typeof dedupUntil === 'number' && dedupUntil > now) {
    return jsonResponse({ success: true, deduplicated: true }, 202)
  }

  dedupStore.set(dedupKey, now + DEDUP_WINDOW_MS)

  const response = await fetch(`${config.url}/rest/v1/contact_messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: config.anonKey,
      Authorization: `Bearer ${config.anonKey}`,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    dedupStore.delete(dedupKey)
    await readResponseError(response, 'Failed to submit contact message.')
    return jsonResponse({ error: 'Pesan belum dapat dikirim saat ini.' }, 502)
  }

  return jsonResponse({ success: true }, 201)
}
