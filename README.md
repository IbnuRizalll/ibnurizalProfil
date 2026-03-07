# Accessible Astro Starter

<img width="1200" height="627" alt="social-preview-image" src="https://github.com/user-attachments/assets/bcd886fb-dd70-4a81-ac73-e138f3ce8d35" />

[![Built with Astro](https://astro.badg.es/v2/built-with-astro/small.svg)](https://astro.build)

A ready-to-use, SEO and accessibility-focused Astro starter template. Built with modern web standards, WCAG 2.2 AA guidelines, and European Accessibility Act (EAA) compliance in mind, it provides a solid foundation for creating inclusive websites. Features Tailwind CSS 4 integration, comprehensive component library with enhanced form validation, color contrast checker, and typography with Atkinson Hyperlegible font for improved readability. Includes a powerful command launcher for keyboard-driven navigation, preference toggles for dark mode, high contrast, and reduced motion, plus dynamic portfolio pages with social sharing, contact forms, and full MDX support.

[![LIVE DEMO](https://img.shields.io/badge/LIVE_DEMO-4ECCA3?style=for-the-badge&logo=astro&logoColor=black)](https://accessible-astro-starter.incluud.dev/) &nbsp;
[![DOCUMENTATION](https://img.shields.io/badge/DOCUMENTATION-A682FF?style=for-the-badge&logo=astro&logoColor=black)](https://accessible-astro.incluud.dev/) &nbsp;
[![Sponsor on Open Collective](https://img.shields.io/badge/Open%20Collective-7FADF2?style=for-the-badge&logo=opencollective&logoColor=white)](https://opencollective.com/incluud) &nbsp;

## Our mission

> Provide developers with accessible, easy-to-use components that make building inclusive web applications simpler and faster, without compromising on customization or performance.

## (Accessibility) Features

- Astro 5.16.0+
- Tailwind CSS 4.1+ support
- TypeScript integration with path aliases for easier imports and content collections support
- Prettier integration with `prettier-plugin-astro` and `prettier-plugin-tailwind`
- ESLint integration with strict accessibility settings for `eslint-plugin-jsx-a11y`
- Markdown and MDX support with comprehensive examples and components
- Modern OKLCH color system with automatic palette generation from primary/secondary colors
- Atkinson Hyperlegible font for improved readability and accessibility
- Lucide icon set via `astro-icon` for consistent, friendly icons
- Semantic HTML structure with `Button`, `Link` and `Heading` components
- Excellent Lighthouse/PageSpeed scores
- Accessible landmarks such as `header`, `main`, `footer`, `section` and `nav`
- Outline focus indicator which works on dark and light backgrounds
- Several `aria` attributes which provide a better experience for screen reader users
- Dynamic portfolio routes demonstrate the use of Astro `getStaticPaths` and pagination
- `404.astro` provides a custom 404 error page which you can adjust to your needs
- `Header.astro` component with optimized accessibility and design
- `Footer.astro` component with informative content and links
- `SkipLinks.astro` component to skip to either the main menu or the main content
- `Navigation.astro` component with keyboard accessible (dropdown) navigation and highlighted menu item option
- `ResponsiveToggle.astro` component with accessible responsive toggle functionality
- Preference toggles for Dark Mode, High Contrast, and Reduced Motion with system preference support
- `ColorContrast.astro` component for enhanced visual clarity and WCAG compliance
- Built-in command launcher with keyboard navigation (Cmd/Ctrl+K) for quick access to preferences and navigation
- `SiteMeta.astro` SEO component for setting custom metadata on different pages
- `.sr-only` utility class for screen reader only text content (hides text visually)
- `prefers-reduced-motion` disables animations for users that have this preference turned on
- Components including `ColorContrast.astro`, `BlockQuote.astro`, `BreakoutImage.astro`, `Logo.astro`, `SocialShares.astro`, `PageHeader.astro`, and `FeaturedProjects.astro`
- Enhanced form components with comprehensive validation: `Form`, `Input`, `Textarea`, `Checkbox`, `Radio`, and `Fieldset` with WCAG 2.2 compliance
- Automatic form validation with custom patterns, error handling, and screen reader support
- Portfolio pages with featured images, author details, social sharing, and breakout images
- Contact page with comprehensive form validation showcase and accessibility demonstrations
- Thank-you page for form submissions with interactive feedback
- Color Contrast Checker interactive page
- Comprehensive sitemap page with organized navigation and automatic XML sitemap generation via `@astrojs/sitemap`
- Enhanced accessible-components showcase page with expanded component demonstrations
- Smooth micro-interactions and animations on hover, open and close states (respecting reduced motion preferences)
- Comprehensive SCSS utility classes
- CSS with logical properties and custom properties
- Accessible button and hyperlink styling with clear focus states
- Styled `<kbd>` element for keyboard shortcut documentation

## Getting started

Clone this theme locally and run any of the following commands in your terminal:

| Command           | Action                                       |
| :---------------- | :------------------------------------------- |
| `npm install`     | Installs dependencies                        |
| `npm run dev`     | Starts local dev server at `localhost:4321`  |
| `npm run start:prod` | Runs production server from `dist/server/entry.mjs` |
| `npm run lint`    | Runs ESLint checks                           |
| `npm run typecheck` | Runs Astro type checks                     |
| `npm run test:unit` | Runs Vitest unit tests                      |
| `npm run test:e2e` | Runs Playwright smoke tests                  |
| `npm test`        | Runs unit tests + e2e smoke tests            |
| `npm run check`   | Runs lint + typecheck + production build     |
| `npm run build`   | Build your production site to `./dist/`      |
| `npm run preview` | Preview your build locally, before deploying |

## Testing

- Unit tests are located in `tests/unit` and run with Vitest.
- E2E smoke tests are located in `tests/e2e` and run with Playwright (Chromium).
- For local E2E setup, install the browser once with `npx playwright install chromium`.
- You can set `PUBLIC_SUPABASE_FETCH_DISABLED=1` (or `SUPABASE_FETCH_DISABLED=1`) to skip server-side Supabase reads during test runs.

## Runtime architecture

- This project is configured for **server output** (`@astrojs/node`, standalone mode).
- Internal Astro API routes (`/api/*`) are required for contact and admin write operations.
- Deploy to a Node-capable runtime (VPS, Docker, Railway, Render, Fly.io, or similar).
- If you want Vercel/Netlify serverless deployment, switch to the matching Astro adapter first.

## Content admin panel (Supabase)

This starter now uses Supabase as the source of truth for portfolio content, with login at `/login` and admin dashboard at `/admin`.

### Setup steps

1. Create a Supabase project.
2. Install Prisma dependencies:
   - `npm install prisma --save-dev`
   - `npm install @prisma/client`
3. Copy `.env.example` to `.env` and set:
   - `DATABASE_URL`
   - `DIRECT_URL`
   - `PUBLIC_SUPABASE_URL`
   - `PUBLIC_SUPABASE_ANON_KEY`
   - `PUBLIC_SUPABASE_ASSETS_BUCKET`
4. Initialize database table via Prisma:
   - `npm run prisma:push`
   - `npm run prisma:generate`
5. Run SQL from `supabase/schema.sql` in the Supabase SQL editor (for RLS policies and trigger setup).
6. Create at least one Supabase Auth user (Email/Password).
7. Run `npm run dev`, open `/login`, then continue to `/admin`.
8. Before pushing changes, run `npm run check`.

### Security reminder

- Never commit real credentials to `.env.example` or source files.
- If credentials are leaked, rotate them immediately in Supabase.

### What the admin edits

- Table: `public.projects`
- Fields: `slug`, `title`, `author`, `description`, `tags`, `body`

### Security model

- Public can read projects (`SELECT` policy)
- Only authenticated users can create/update/delete projects (`INSERT/UPDATE/DELETE` policies)
- Write operations from `/contact` and `/admin/*` go through internal Astro API routes (`/api/*`) with server-side token verification.

## Accessible Astro ecosystem

The Accessible Astro ecosystem is a collection of projects that are designed to help you build accessible web applications. It includes:

- [Accessible Astro Starter](https://github.com/incluud/accessible-astro-starter): Fully accessible starter for kickstarting Astro projects, with Tailwind.
- [Accessible Astro Components](https://github.com/incluud/accessible-astro-components/): Library of reusable, accessible components built for Astro.
- [Accessible Astro Dashboard](https://github.com/incluud/accessible-astro-dashboard/): User-friendly dashboard interface with a login screen and widgets.
- [Accessible Astro Launcher](https://github.com/incluud/accessible-astro-launcher): Command palette/launcher component for Astro projects.
- [Accessible Astro Docs](https://github.com/incluud/accessible-astro-docs): Comprehensive documentation for all Accessible Astro projects.
- [Color Contrast Checker](https://github.com/incluud/color-contrast-checker): WCAG-compliant color contrast checker with design system token generation.

Check out our [roadmap](https://github.com/orgs/incluud/projects/4/views/1) to see what's coming next!

## Contributing

We welcome contributions to improve the documentation! You can help by:

1. [Filing an issue](https://github.com/incluud/accessible-astro-starter/issues)
2. [Submitting a pull request](https://github.com/incluud/accessible-astro-starter/pulls)
3. [Starting a discussion](https://github.com/incluud/accessible-astro-starter/discussions)
4. [Supporting on Open Collective](https://opencollective.com/incluud)

## Support this project

Your support helps us cover basic costs and continue building accessible solutions for the Astro ecosystem. By becoming a sponsor, you're not just supporting code – you're helping create a more inclusive web for everyone. Every contribution, big or small, helps maintain and improve these accessibility-focused tools.

[![Sponsor on Open Collective](https://img.shields.io/badge/Open%20Collective-7FADF2?style=for-the-badge&logo=opencollective&logoColor=white)](https://opencollective.com/incluud)

## Together we make a difference

We want to express our heartfelt gratitude to everyone who contributes to making the web more accessible:

- **The Astro team** for creating an amazing static site generator and the wonderful Starlight theme
- **Our contributors** who dedicate their time and expertise to improve these tools
- [**Niek Derksen**](https://niekderksen.nl) for conducting comprehensive accessibility audits to ensure WCAG compliance
- **Our sponsors** who help make this project sustainable
- **The web community** for embracing and promoting web accessibility
- **You, the developer** for choosing to make your projects more accessible

<a href="https://github.com/incluud/accessible-astro-starter/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=incluud/accessible-astro-starter" />
</a><br /><br />

Together, we're not just building documentation or components – we're creating a more inclusive and accessible web for everyone. Every contribution, whether it's code, documentation, bug reports, or feedback, helps move us closer to this goal. ✨

Remember: Accessibility is not a feature, it's a fundamental right. Thank you for being part of this journey!
