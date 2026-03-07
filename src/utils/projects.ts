import {
  fetchSupabaseRows,
  isSupabaseConfigured as sharedSupabaseConfigured,
  normalizeSupabaseContentEntity,
  type ContentBlock,
  type ContentImageBlock,
  type ContentParagraphBlock,
  type ContentTableBlock,
  type SupabaseContentRow,
} from '@utils/supabase-content'

export type PortfolioParagraphBlock = ContentParagraphBlock
export type PortfolioImageBlock = ContentImageBlock
export type PortfolioTableBlock = ContentTableBlock
export type PortfolioContentBlock = ContentBlock

export interface PortfolioProject {
  id: string
  slug: string
  title: string
  author: string
  description: string
  tags: string[]
  body: string
  coverImageUrl: string | null
  contentBlocks: PortfolioContentBlock[]
  createdAt: string | null
}

type SupabaseProjectRow = SupabaseContentRow

export const isSupabaseConfigured = sharedSupabaseConfigured

const PROJECTS_LIST_LATEST_SELECT = 'id,slug,title,author,description,tags,cover_image_url,created_at'
const PROJECTS_LIST_LEGACY_SELECT = 'id,slug,title,author,description,tags,created_at'
const PROJECTS_DETAIL_LATEST_SELECT =
  'id,slug,title,author,description,tags,body,cover_image_url,content_blocks,created_at'
const PROJECTS_DETAIL_LEGACY_SELECT = 'id,slug,title,author,description,tags,body,created_at'

interface GetProjectsOptions {
  includeContent?: boolean
  limit?: number
  cacheTtlMs?: number
}

export async function getProjects(options: GetProjectsOptions = {}): Promise<PortfolioProject[]> {
  const { includeContent = false, limit, cacheTtlMs } = options
  const rows = await fetchSupabaseRows<SupabaseProjectRow>({
    table: 'projects',
    latestSelect: includeContent ? PROJECTS_DETAIL_LATEST_SELECT : PROJECTS_LIST_LATEST_SELECT,
    legacySelect: includeContent ? PROJECTS_DETAIL_LEGACY_SELECT : PROJECTS_LIST_LEGACY_SELECT,
    fetchFailureMessage: 'Supabase projects fetch failed for both latest and legacy schema.',
    fetchErrorMessage: 'Supabase projects fetch error',
    limit,
    cacheTtlMs,
  })

  return rows.map((row) => normalizeSupabaseContentEntity(row, { fallbackTitle: 'Untitled project' }))
}

export async function getProjectBySlug(slug: string): Promise<PortfolioProject | null> {
  const normalizedSlug = String(slug || '').trim()
  if (!normalizedSlug) return null

  const rows = await fetchSupabaseRows<SupabaseProjectRow>({
    table: 'projects',
    latestSelect: PROJECTS_DETAIL_LATEST_SELECT,
    legacySelect: PROJECTS_DETAIL_LEGACY_SELECT,
    fetchFailureMessage: `Supabase project fetch failed for slug "${normalizedSlug}".`,
    fetchErrorMessage: 'Supabase project detail fetch error',
    filters: [{ column: 'slug', operator: 'eq', value: normalizedSlug }],
    limit: 1,
  })

  const row = rows[0]
  if (!row) return null

  return normalizeSupabaseContentEntity(row, { fallbackTitle: 'Untitled project' })
}
