export interface SupabaseServerConfig {
  url: string
  anonKey: string
  assetsBucket: string
}

interface SupabaseAuthResult {
  ok: boolean
  error?: string
  email?: string
  userId?: string
}
interface SupabaseUserResponse {
  id?: string
  email?: string
}

export function getSupabaseServerConfig(): SupabaseServerConfig | null {
  const url = import.meta.env.PUBLIC_SUPABASE_URL
  const anonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY
  const assetsBucket = import.meta.env.PUBLIC_SUPABASE_ASSETS_BUCKET ?? 'site-assets'

  if (!url || !anonKey) {
    return null
  }

  return {
    url: url.replace(/\/$/, ''),
    anonKey,
    assetsBucket,
  }
}

export function getBearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) return null
  const value = authorizationHeader.trim()
  if (!value.toLowerCase().startsWith('bearer ')) return null
  const token = value.slice(7).trim()
  return token.length > 0 ? token : null
}

export async function verifySupabaseAccessToken(
  config: SupabaseServerConfig,
  accessToken: string | null,
): Promise<SupabaseAuthResult> {
  if (!accessToken) {
    return { ok: false, error: 'Missing bearer token.' }
  }

  try {
    const response = await fetch(`${config.url}/auth/v1/user`, {
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      return { ok: false, error: 'Session is invalid or expired.' }
    }

    const payload = (await readJsonSafe<SupabaseUserResponse>(response)) ?? null
    return {
      ok: true,
      email: typeof payload?.email === 'string' ? payload.email.trim().toLowerCase() : undefined,
      userId: typeof payload?.id === 'string' ? payload.id.trim() : undefined,
    }
  } catch {
    return { ok: false, error: 'Unable to verify session.' }
  }
}

export function isAdminEmailAllowed(email: string | null | undefined): boolean {
  const rawAllowList =
    import.meta.env.ADMIN_ALLOWED_EMAILS ??
    import.meta.env.ADMIN_EMAIL_ALLOWLIST ??
    (typeof process !== 'undefined'
      ? process.env.ADMIN_ALLOWED_EMAILS || process.env.ADMIN_EMAIL_ALLOWLIST
      : undefined)

  const allowedEmails = String(rawAllowList ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)

  if (allowedEmails.length === 0) {
    return true
  }

  const normalized = String(email ?? '').trim().toLowerCase()
  if (!normalized) {
    return false
  }

  return allowedEmails.includes(normalized)
}

export async function readJsonSafe<T>(source: { json: () => Promise<unknown> }): Promise<T | null> {
  try {
    return (await source.json()) as T
  } catch {
    return null
  }
}

export async function readResponseError(response: Response, fallbackMessage: string): Promise<string> {
  const body = await readJsonSafe<{ message?: string; error?: string; hint?: string }>(response)

  if (body?.message && typeof body.message === 'string') {
    return body.message
  }

  if (body?.error && typeof body.error === 'string') {
    return body.error
  }

  if (body?.hint && typeof body.hint === 'string') {
    return body.hint
  }

  if (response.statusText) {
    return `${fallbackMessage} (${response.status} ${response.statusText})`
  }

  return fallbackMessage
}
