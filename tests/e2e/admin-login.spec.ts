import { expect, test } from '@playwright/test'

const supabaseModuleMock = `
const sessionKey = '__mock_supabase_session__'
const listeners = new Set()

function readSession() {
  try {
    return JSON.parse(localStorage.getItem(sessionKey) || 'null')
  } catch {
    return null
  }
}

function writeSession(value) {
  if (value) {
    localStorage.setItem(sessionKey, JSON.stringify(value))
  } else {
    localStorage.removeItem(sessionKey)
  }
}

function emit(event, session) {
  listeners.forEach((listener) => {
    try {
      listener(event, session)
    } catch {}
  })
}

function createAuth() {
  return {
    async getSession() {
      return { data: { session: readSession() }, error: null }
    },
    async signInWithPassword({ email }) {
      const session = {
        access_token: 'mock-access-token',
        user: {
          email: email || 'admin@example.com'
        }
      }
      writeSession(session)
      emit('SIGNED_IN', session)
      return { data: { session }, error: null }
    },
    async signOut() {
      writeSession(null)
      emit('SIGNED_OUT', null)
      return { error: null }
    },
    onAuthStateChange(callback) {
      listeners.add(callback)
      return {
        data: {
          subscription: {
            unsubscribe() {
              listeners.delete(callback)
            }
          }
        }
      }
    }
  }
}

function createSelectChain(table) {
  if (table === 'site_settings') {
    return {
      eq() {
        return {
          async maybeSingle() {
            return { data: null, error: null }
          }
        }
      }
    }
  }

  return {
    async order() {
      return { data: [], error: null }
    }
  }
}

export function createClient() {
  const auth = createAuth()
  return {
    auth,
    from(table) {
      return {
        select() {
          return createSelectChain(table)
        }
      }
    }
  }
}
`

test('admin login redirects to dashboard and sign out returns to login', async ({ page }) => {
  await page.route('**/@supabase/supabase-js@2.57.4*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: supabaseModuleMock,
    })
  })

  await page.goto('/login')
  await expect(page.getByText('Please sign in.')).toBeVisible()

  await page.getByLabel('Email').fill('admin@example.com')
  await page.getByLabel('Password').fill('secure-password')

  await Promise.all([
    page.waitForURL('**/admin/about'),
    page.getByRole('button', { name: 'Sign in' }).click(),
  ])

  await expect(page.getByRole('heading', { name: 'Edit About Me' })).toBeVisible()
  await expect(page.locator('#app-section')).toBeVisible()

  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login/)
})
