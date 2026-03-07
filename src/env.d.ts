/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_SUPABASE_URL?: string
  readonly PUBLIC_SUPABASE_ANON_KEY?: string
  readonly PUBLIC_SUPABASE_ASSETS_BUCKET?: string
  readonly PUBLIC_SUPABASE_FETCH_DISABLED?: string
  readonly SUPABASE_FETCH_DISABLED?: string
  readonly PUBLIC_SUPABASE_CONTENT_CACHE_TTL_MS?: string
  readonly SUPABASE_CONTENT_CACHE_TTL_MS?: string
  readonly PUBLIC_SUPABASE_SITE_SETTINGS_CACHE_TTL_MS?: string
  readonly SUPABASE_SITE_SETTINGS_CACHE_TTL_MS?: string
  readonly PUBLIC_ADMIN_IDLE_TIMEOUT_MINUTES?: string
  readonly ADMIN_ALLOWED_EMAILS?: string
  readonly ADMIN_EMAIL_ALLOWLIST?: string
}
