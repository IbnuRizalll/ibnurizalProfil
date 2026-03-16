export interface SiteSettings {
  logoUrl: string
  homeImageUrl: string
  heroDescription: string
  aboutMe: string
}

interface SupabaseSiteSettingsRow {
  id: string
  logo_url: string | null
  home_image_url: string | null
  hero_description: string | null
  about_me: string | null
}

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY
const supabaseFetchDisabledEnv =
  import.meta.env.PUBLIC_SUPABASE_FETCH_DISABLED ??
  import.meta.env.SUPABASE_FETCH_DISABLED ??
  (typeof process !== 'undefined' ? process.env.SUPABASE_FETCH_DISABLED : undefined)
const isSupabaseFetchDisabled = supabaseFetchDisabledEnv === '1' || supabaseFetchDisabledEnv === 'true'
let hasWarnedMissingSiteSettingsTable = false
const siteSettingsCacheTtlEnv =
  import.meta.env.PUBLIC_SUPABASE_SITE_SETTINGS_CACHE_TTL_MS ??
  import.meta.env.SUPABASE_SITE_SETTINGS_CACHE_TTL_MS ??
  (typeof process !== 'undefined' ? process.env.SUPABASE_SITE_SETTINGS_CACHE_TTL_MS : undefined)
const siteSettingsCacheTtlMs = Math.max(0, Number.parseInt(String(siteSettingsCacheTtlEnv ?? '30000'), 10) || 30000)
let cachedSiteSettings: { value: SiteSettings; expiresAt: number } | null = null
let inFlightSiteSettingsPromise: Promise<SiteSettings> | null = null

export const defaultSiteSettings: SiteSettings = {
  logoUrl: '',
  homeImageUrl: '/astronaut-hero-img.webp',
  heroDescription:
    'Saya Ibnu Rizal Mutaqim, seorang developer yang berfokus membangun website cepat, rapi, dan mudah dikelola.',
  aboutMe:
    'Saya fokus pada pengembangan web modern yang cepat, accessible, dan mudah dipelihara. Saya terbiasa mengerjakan antarmuka, integrasi API, serta optimasi performa agar produk digital siap dipakai di dunia nyata.',
}

function normalizeString(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeSiteSettings(row: SupabaseSiteSettingsRow | null): SiteSettings {
  if (!row) {
    return defaultSiteSettings
  }

  return {
    logoUrl: normalizeString(row.logo_url),
    homeImageUrl: normalizeString(row.home_image_url) || defaultSiteSettings.homeImageUrl,
    heroDescription: normalizeString(row.hero_description) || defaultSiteSettings.heroDescription,
    aboutMe: normalizeString(row.about_me) || defaultSiteSettings.aboutMe,
  }
}

export async function getSiteSettings(): Promise<SiteSettings> {
  if (isSupabaseFetchDisabled || !supabaseUrl || !supabaseAnonKey) {
    return defaultSiteSettings
  }

  const now = Date.now()
  if (cachedSiteSettings && cachedSiteSettings.expiresAt > now) {
    return cachedSiteSettings.value
  }

  if (inFlightSiteSettingsPromise) {
    return inFlightSiteSettingsPromise
  }

  inFlightSiteSettingsPromise = (async () => {
    try {
      const endpoint = new URL('/rest/v1/site_settings', supabaseUrl)
      endpoint.searchParams.set('select', 'id,logo_url,home_image_url,hero_description,about_me')
      endpoint.searchParams.set('id', 'eq.main')
      endpoint.searchParams.set('limit', '1')

      const response = await fetch(endpoint.toString(), {
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`,
        },
      })

      if (!response.ok) {
        if (response.status === 404) {
          if (!hasWarnedMissingSiteSettingsTable) {
            console.warn(
              'Supabase table "site_settings" not found. Jalankan SQL terbaru di supabase/schema.sql lalu refresh.',
            )
            hasWarnedMissingSiteSettingsTable = true
          }
          return defaultSiteSettings
        }

        console.warn(`Supabase site_settings fetch failed: ${response.status} ${response.statusText}`)
        return defaultSiteSettings
      }

      const data = (await response.json()) as SupabaseSiteSettingsRow[]
      const row = Array.isArray(data) && data.length > 0 ? data[0] : null
      const normalized = normalizeSiteSettings(row)
      if (siteSettingsCacheTtlMs > 0) {
        cachedSiteSettings = {
          value: normalized,
          expiresAt: Date.now() + siteSettingsCacheTtlMs,
        }
      }
      return normalized
    } catch (error) {
      console.warn('Supabase site_settings fetch error', error)
      return defaultSiteSettings
    } finally {
      inFlightSiteSettingsPromise = null
    }
  })()

  return inFlightSiteSettingsPromise
}
