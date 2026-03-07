import {
  fetchSupabaseRows,
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

type SupabaseBlogRow = SupabaseContentRow

const BLOG_POSTS_LIST_LATEST_SELECT = 'id,slug,title,author,description,tags,cover_image_url,created_at'
const BLOG_POSTS_LIST_LEGACY_SELECT = 'id,slug,title,author,description,tags,created_at'
const BLOG_POSTS_DETAIL_LATEST_SELECT =
  'id,slug,title,author,description,tags,body,cover_image_url,content_blocks,created_at'
const BLOG_POSTS_DETAIL_LEGACY_SELECT = 'id,slug,title,author,description,tags,body,created_at'

interface GetBlogPostsOptions {
  includeContent?: boolean
  limit?: number
  cacheTtlMs?: number
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
