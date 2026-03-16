import {
  fetchSupabaseRows,
  fetchSupabaseRowsWithCount,
  normalizeSupabaseContentEntity,
  type ContentBlock,
  type ContentImageBlock,
  type ContentParagraphBlock,
  type ContentTableBlock,
  type SupabaseContentRow,
} from '@utils/supabase-content'

export type BlogParagraphBlock = ContentParagraphBlock
export type BlogImageBlock = ContentImageBlock
export type BlogTableBlock = ContentTableBlock
export type BlogContentBlock = ContentBlock

export interface BlogPost {
  id: string
  slug: string
  title: string
  author: string
  description: string
  tags: string[]
  body: string
  coverImageUrl: string | null
  contentBlocks: BlogContentBlock[]
  createdAt: string | null
}

export interface BlogPostSearchItem {
  slug: string
  title: string
  author: string
  tags: string[]
}

export interface PaginatedBlogPostsResult {
  items: BlogPost[]
  totalItems: number
}

type SupabaseBlogRow = SupabaseContentRow

type SupabaseBlogSearchRow = Pick<SupabaseContentRow, 'slug' | 'title' | 'author' | 'tags'>

const BLOG_POSTS_LIST_LATEST_SELECT = 'id,slug,title,author,description,tags,cover_image_url,created_at'
const BLOG_POSTS_LIST_LEGACY_SELECT = 'id,slug,title,author,description,tags,created_at'
const BLOG_POSTS_DETAIL_LATEST_SELECT =
  'id,slug,title,author,description,tags,body,cover_image_url,content_blocks,created_at'
const BLOG_POSTS_DETAIL_LEGACY_SELECT = 'id,slug,title,author,description,tags,body,created_at'
const BLOG_POSTS_SEARCH_LATEST_SELECT = 'slug,title,author,tags'
const BLOG_POSTS_SEARCH_LEGACY_SELECT = 'slug,title,author,tags'

interface GetBlogPostsOptions {
  includeContent?: boolean
  limit?: number
  cacheTtlMs?: number
}

interface GetBlogPostsPageOptions {
  page: number
  pageSize: number
  cacheTtlMs?: number
}

interface GetBlogPostSearchIndexOptions {
  cacheTtlMs?: number
}

function normalizePositiveInt(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 ? value : fallback
}

export async function getBlogPosts(options: GetBlogPostsOptions = {}): Promise<BlogPost[]> {
  const { includeContent = false, limit, cacheTtlMs } = options
  const rows = await fetchSupabaseRows<SupabaseBlogRow>({
    table: 'blog_posts',
    latestSelect: includeContent ? BLOG_POSTS_DETAIL_LATEST_SELECT : BLOG_POSTS_LIST_LATEST_SELECT,
    legacySelect: includeContent ? BLOG_POSTS_DETAIL_LEGACY_SELECT : BLOG_POSTS_LIST_LEGACY_SELECT,
    fetchFailureMessage: 'Supabase blog_posts fetch failed for both latest and legacy schema.',
    fetchErrorMessage: 'Supabase blog_posts fetch error',
    limit,
    cacheTtlMs,
  })

  return rows.map((row) => normalizeSupabaseContentEntity(row, { fallbackTitle: 'Untitled post' }))
}

export async function getPaginatedBlogPosts(options: GetBlogPostsPageOptions): Promise<PaginatedBlogPostsResult> {
  const pageSize = normalizePositiveInt(options.pageSize, 6)
  const requestedPage = normalizePositiveInt(options.page, 1)
  const offset = (requestedPage - 1) * pageSize

  const result = await fetchSupabaseRowsWithCount<SupabaseBlogRow>({
    table: 'blog_posts',
    latestSelect: BLOG_POSTS_LIST_LATEST_SELECT,
    legacySelect: BLOG_POSTS_LIST_LEGACY_SELECT,
    fetchFailureMessage: 'Supabase paginated blog_posts fetch failed for both latest and legacy schema.',
    fetchErrorMessage: 'Supabase paginated blog_posts fetch error',
    limit: pageSize,
    offset,
    cacheTtlMs: options.cacheTtlMs,
  })

  return {
    items: result.rows.map((row) => normalizeSupabaseContentEntity(row, { fallbackTitle: 'Untitled post' })),
    totalItems: Math.max(result.totalCount ?? 0, result.rows.length),
  }
}

export async function getBlogPostSearchIndex(
  options: GetBlogPostSearchIndexOptions = {},
): Promise<BlogPostSearchItem[]> {
  const rows = await fetchSupabaseRows<SupabaseBlogSearchRow>({
    table: 'blog_posts',
    latestSelect: BLOG_POSTS_SEARCH_LATEST_SELECT,
    legacySelect: BLOG_POSTS_SEARCH_LEGACY_SELECT,
    fetchFailureMessage: 'Supabase blog_posts launcher fetch failed for both latest and legacy schema.',
    fetchErrorMessage: 'Supabase blog_posts launcher fetch error',
    cacheTtlMs: options.cacheTtlMs,
  })

  return rows
    .map((row) => ({
      slug: String(row.slug || '').trim(),
      title: String(row.title || '').trim(),
      author: String(row.author || '').trim(),
      tags: Array.isArray(row.tags)
        ? row.tags.map((tag) => String(tag).trim()).filter(Boolean)
        : typeof row.tags === 'string'
          ? row.tags
              .split(',')
              .map((tag) => tag.trim())
              .filter(Boolean)
          : [],
    }))
    .filter((row) => row.slug && row.title)
}

export async function getBlogPostBySlug(slug: string): Promise<BlogPost | null> {
  const normalizedSlug = String(slug || '').trim()
  if (!normalizedSlug) return null

  const rows = await fetchSupabaseRows<SupabaseBlogRow>({
    table: 'blog_posts',
    latestSelect: BLOG_POSTS_DETAIL_LATEST_SELECT,
    legacySelect: BLOG_POSTS_DETAIL_LEGACY_SELECT,
    fetchFailureMessage: `Supabase blog post fetch failed for slug "${normalizedSlug}".`,
    fetchErrorMessage: 'Supabase blog post detail fetch error',
    filters: [{ column: 'slug', operator: 'eq', value: normalizedSlug }],
    limit: 1,
  })

  const row = rows[0]
  if (!row) return null

  return normalizeSupabaseContentEntity(row, { fallbackTitle: 'Untitled post' })
}
