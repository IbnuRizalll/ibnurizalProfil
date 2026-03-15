import { defineConfig } from 'astro/config'
import { fileURLToPath } from 'url'
import node from '@astrojs/node'
import vercel from '@astrojs/vercel'
import compress from 'astro-compress'
import icon from 'astro-icon'
import mdx from '@astrojs/mdx'
import sitemap from '@astrojs/sitemap'
import tailwindcss from '@tailwindcss/vite'
import { enhanceConfigForWorkspace } from './scripts/workspace-config.js'

const siteUrl = 'https://ibnurizal-profil.vercel.app'
const excludedSitemapPrefixes = ['/admin', '/login', '/thank-you']
const securityAllowedDomains = [
  {
    protocol: 'https',
    hostname: new URL(siteUrl).hostname,
  },
  {
    protocol: 'https',
    hostname: '**.vercel.app',
  },
]

function shouldIncludeInSitemap(page) {
  const rawValue = typeof page === 'string' ? page : String(page || '')
  let pathname = rawValue

  try {
    pathname = new URL(rawValue).pathname
  } catch {
    pathname = rawValue
  }

  return !excludedSitemapPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

// Vite configuration with path aliases and SCSS settings
const viteConfig = {
  css: {
    preprocessorOptions: {
      scss: {
        logger: {
          warn: () => {},
        },
      },
    },
  },
  plugins: [tailwindcss()],
  resolve: {
    alias: {
      '@components': fileURLToPath(new URL('./src/components', import.meta.url)),
      '@layouts': fileURLToPath(new URL('./src/layouts', import.meta.url)),
      '@assets': fileURLToPath(new URL('./src/assets', import.meta.url)),
      '@content': fileURLToPath(new URL('./src/content', import.meta.url)),
      '@pages': fileURLToPath(new URL('./src/pages', import.meta.url)),
      '@public': fileURLToPath(new URL('./public', import.meta.url)),
      '@post-images': fileURLToPath(new URL('./public/posts', import.meta.url)),
      '@project-images': fileURLToPath(new URL('./public/projects', import.meta.url)),
      '@utils': fileURLToPath(new URL('./src/utils', import.meta.url)),
      '@server': fileURLToPath(new URL('./src/server', import.meta.url)),
      '@theme-config': fileURLToPath(new URL('./theme.config.ts', import.meta.url)),
    },
  },
}

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: process.env.VERCEL ? vercel() : node({ mode: 'standalone' }),
  compressHTML: true,
  site: siteUrl,
  security: {
    allowedDomains: securityAllowedDomains,
  },
  integrations: [
    compress(),
    icon(),
    mdx(),
    sitemap({
      filter: shouldIncludeInSitemap,
    }),
  ],
  vite: enhanceConfigForWorkspace(viteConfig),
})

