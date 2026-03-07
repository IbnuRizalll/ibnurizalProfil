import { describe, expect, it } from 'vitest'
import {
  normalizeContentBlocks,
  normalizeSupabaseContentEntity,
  normalizeTags,
  type SupabaseContentRow,
} from '../../src/utils/supabase-content'

describe('normalizeTags', () => {
  it('normalizes tag arrays', () => {
    expect(normalizeTags([' astro ', '', 'a11y'])).toEqual(['astro', 'a11y'])
  })

  it('normalizes comma-separated strings', () => {
    expect(normalizeTags('astro, a11y,  performance ,')).toEqual(['astro', 'a11y', 'performance'])
  })

  it('returns empty array for missing values', () => {
    expect(normalizeTags(null)).toEqual([])
    expect(normalizeTags(undefined)).toEqual([])
  })
})

describe('normalizeContentBlocks', () => {
  it('normalizes paragraph, image, and table blocks', () => {
    const normalized = normalizeContentBlocks(
      JSON.stringify([
        { type: 'paragraph', text: '  Intro text.  ' },
        { type: 'image', src: 'cover-image.webp', alt: '  cover alt  ', caption: '  caption  ' },
        {
          type: 'table',
          caption: '  Stats  ',
          headers: ['  Year ', '', 'Revenue  '],
          rows: [[' 2024 ', ' 120K '], ['  ', '  ']],
        },
        { type: 'paragraph', text: '   ' },
      ]),
    )

    expect(normalized).toEqual([
      {
        id: 'block-1',
        type: 'paragraph',
        text: 'Intro text.',
      },
      {
        id: 'block-2',
        type: 'image',
        url: 'cover-image.webp',
        alt: 'cover alt',
        caption: 'caption',
      },
      {
        id: 'block-3',
        type: 'table',
        caption: 'Stats',
        headers: ['Year', 'Revenue'],
        rows: [['2024', '120K']],
      },
    ])
  })

  it('supports object source with blocks array', () => {
    const normalized = normalizeContentBlocks({
      blocks: [{ id: 'intro', type: 'paragraph', text: 'Hello there' }],
    })

    expect(normalized).toEqual([
      {
        id: 'intro',
        type: 'paragraph',
        text: 'Hello there',
      },
    ])
  })

  it('returns empty array for invalid JSON strings', () => {
    expect(normalizeContentBlocks('{not-json')).toEqual([])
  })
})

describe('normalizeSupabaseContentEntity', () => {
  it('applies fallback values and normalized fields', () => {
    const row: SupabaseContentRow = {
      id: 'row-1',
      slug: null,
      title: null,
      author: null,
      description: '  Brief desc  ',
      tags: 'astro, cms',
      body: null,
      cover_image_url: '',
      content_blocks: [{ type: 'paragraph', text: '  Main paragraph  ' }],
      created_at: '2026-03-03T00:00:00.000Z',
    }

    const normalized = normalizeSupabaseContentEntity(row, {
      fallbackTitle: 'Fallback Post',
    })

    expect(normalized).toEqual({
      id: 'row-1',
      slug: 'fallback-post',
      title: 'Fallback Post',
      author: 'Unknown author',
      description: 'Brief desc',
      tags: ['astro', 'cms'],
      body: '',
      coverImageUrl: null,
      contentBlocks: [
        {
          id: 'block-1',
          type: 'paragraph',
          text: 'Main paragraph',
        },
      ],
      createdAt: '2026-03-03T00:00:00.000Z',
    })
  })
})
