import {
  fetchSupabaseRows,
  fetchSupabaseRowsWithCount,
  isSupabaseConfigured as sharedSupabaseConfigured,
  normalizeSupabaseContentEntity,
  normalizeTags,
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

export interface PortfolioProjectSearchItem {
  slug: string
  title: string
  author: string
  tags: string[]
}

export interface PaginatedProjectsResult {
  items: PortfolioProject[]
  totalItems: number
}

type SupabaseProjectRow = SupabaseContentRow

type SupabaseProjectSearchRow = Pick<SupabaseContentRow, 'slug' | 'title' | 'author' | 'tags'>

export const isSupabaseConfigured = sharedSupabaseConfigured

const PROJECTS_LIST_LATEST_SELECT = 'id,slug,title,author,description,tags,cover_image_url,created_at'
const PROJECTS_LIST_LEGACY_SELECT = 'id,slug,title,author,description,tags,created_at'
const PROJECTS_DETAIL_LATEST_SELECT =
  'id,slug,title,author,description,tags,body,cover_image_url,content_blocks,created_at'
const PROJECTS_DETAIL_LEGACY_SELECT = 'id,slug,title,author,description,tags,body,created_at'
const PROJECTS_SEARCH_LATEST_SELECT = 'slug,title,author,tags'
const PROJECTS_SEARCH_LEGACY_SELECT = 'slug,title,author,tags'
const PROJECTS_TAGS_LATEST_SELECT = 'tags'
const PROJECTS_TAGS_LEGACY_SELECT = 'tags'

interface GetProjectsOptions {
  includeContent?: boolean
  limit?: number
  cacheTtlMs?: number
}

interface GetProjectsPageOptions {
  page: number
  pageSize: number
  cacheTtlMs?: number
  tag?: string
}

interface GetProjectSearchIndexOptions {
  cacheTtlMs?: number
}

interface GetProjectTagsOptions {
  cacheTtlMs?: number
}

function normalizePositiveInt(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 ? value : fallback
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

export async function getPaginatedProjects(options: GetProjectsPageOptions): Promise<PaginatedProjectsResult> {
  const pageSize = normalizePositiveInt(options.pageSize, 6)
  const requestedPage = normalizePositiveInt(options.page, 1)
  const offset = (requestedPage - 1) * pageSize
  const normalizedTag = String(options.tag || '')
    .trim()
    .toLowerCase()

  const result = await fetchSupabaseRowsWithCount<SupabaseProjectRow>({
    table: 'projects',
    latestSelect: PROJECTS_LIST_LATEST_SELECT,
    legacySelect: PROJECTS_LIST_LEGACY_SELECT,
    fetchFailureMessage: 'Supabase paginated projects fetch failed for both latest and legacy schema.',
    fetchErrorMessage: 'Supabase paginated projects fetch error',
    limit: pageSize,
    offset,
    cacheTtlMs: options.cacheTtlMs,
    filters: normalizedTag ? [{ column: 'tags', operator: 'ov', value: [normalizedTag] }] : undefined,
  })

  return {
    items: result.rows.map((row) => normalizeSupabaseContentEntity(row, { fallbackTitle: 'Untitled project' })),
    totalItems: Math.max(result.totalCount ?? 0, result.rows.length),
  }
}

export async function getProjectSearchIndex(
  options: GetProjectSearchIndexOptions = {},
): Promise<PortfolioProjectSearchItem[]> {
  const rows = await fetchSupabaseRows<SupabaseProjectSearchRow>({
    table: 'projects',
    latestSelect: PROJECTS_SEARCH_LATEST_SELECT,
    legacySelect: PROJECTS_SEARCH_LEGACY_SELECT,
    fetchFailureMessage: 'Supabase projects launcher fetch failed for both latest and legacy schema.',
    fetchErrorMessage: 'Supabase projects launcher fetch error',
    cacheTtlMs: options.cacheTtlMs,
  })

  return rows
    .map((row) => ({
      slug: String(row.slug || '').trim(),
      title: String(row.title || '').trim(),
      author: String(row.author || '').trim(),
      tags: normalizeTags(row.tags),
    }))
    .filter((row) => row.slug && row.title)
}

export async function getProjectTags(options: GetProjectTagsOptions = {}): Promise<string[]> {
  const rows = await fetchSupabaseRows<Pick<SupabaseProjectRow, 'tags'>>({
    table: 'projects',
    latestSelect: PROJECTS_TAGS_LATEST_SELECT,
    legacySelect: PROJECTS_TAGS_LEGACY_SELECT,
    fetchFailureMessage: 'Supabase projects tags fetch failed for both latest and legacy schema.',
    fetchErrorMessage: 'Supabase projects tags fetch error',
    cacheTtlMs: options.cacheTtlMs,
  })

  const tagSet = new Set<string>()
  rows.forEach((row) => {
    normalizeTags(row.tags).forEach((tag) => {
      if (tag) tagSet.add(tag)
    })
  })

  return [...tagSet].sort((a, b) => a.localeCompare(b))
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
