import { describe, expect, it } from 'vitest'
import { slugify } from '../../src/utils/slugify'

describe('slugify', () => {
  it('converts text into lowercase hyphenated slug', () => {
    expect(slugify('Hello Astro World')).toBe('hello-astro-world')
  })

  it('removes punctuation and trims surrounding separators', () => {
    expect(slugify('  ---A11y & SEO Ready!!!  ')).toBe('a11y-seo-ready')
  })

  it('returns empty string when value has no alphanumeric content', () => {
    expect(slugify('---***---')).toBe('')
  })
})
