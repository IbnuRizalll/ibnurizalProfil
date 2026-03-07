import { expect, test } from '@playwright/test'

test('contact form submits payload and redirects to thank-you page', async ({ page }) => {
  let capturedPayload: Record<string, unknown> = {}

  await page.route('**/api/contact-messages', async (route) => {
    capturedPayload = route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'ok' }),
    })
  })

  await page.goto('/contact')

  await page.getByLabel('Nama').fill('Ibnu Test')
  await page.getByLabel('Email').fill('ibnu@example.com')
  await page.getByLabel('WhatsApp Number').fill('081234567890')
  await page.getByLabel('Pesan').fill('Halo, saya ingin konsultasi website.')

  await Promise.all([
    page.waitForURL('**/thank-you'),
    page.getByRole('button', { name: 'Send Message' }).click(),
  ])

  const payload = capturedPayload
  expect(payload['full_name']).toBe('Ibnu Test')
  expect(payload['email']).toBe('ibnu@example.com')
  expect(payload['phone']).toBe('+6281234567890')
  expect(payload['message']).toBe('Halo, saya ingin konsultasi website.')
})
