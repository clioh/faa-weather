/**
 * Shared Resend email helpers for order and license mail.
 * Lives under api/_lib/ so Vercel does not deploy it as a function.
 */

import { Resend } from 'resend'

export const ORDERS_FROM = 'SkyGlass <orders@skyglass.dev>'
export const LICENSE_FROM = 'SkyGlass <licenses@skyglass.dev>'
export const SUPPORT_EMAIL = 'support@skyglass.dev'
export const MANAGE_URL = 'https://skyglass.dev/license'

let client: Resend | null = null

function resend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null
  if (!client) client = new Resend(process.env.RESEND_API_KEY)
  return client
}

/** Send an email. Returns false (and logs) on any failure; never throws. */
export async function sendEmail(opts: { from?: string; to: string; subject: string; html: string }): Promise<boolean> {
  const r = resend()
  if (!r) {
    console.error('[Email] RESEND_API_KEY not configured, not sending:', opts.subject)
    return false
  }
  try {
    const { error } = await r.emails.send({ from: opts.from ?? ORDERS_FROM, to: opts.to, subject: opts.subject, html: opts.html })
    if (error) {
      console.error('[Email] Send failed:', error)
      return false
    }
    return true
  } catch (err) {
    console.error('[Email] Send error:', err)
    return false
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Dark SkyGlass email shell: logo header, content, footer. */
export function emailLayout(title: string, contentHtml: string): string {
  const currentYear = new Date().getFullYear()
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - SkyGlass</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0a0a0f; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 560px; margin: 0 auto; background-color: #12121a; border: 1px solid #2a2a3a; border-radius: 12px;">
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center; border-bottom: 1px solid #2a2a3a;">
              <div style="font-size: 24px; font-weight: bold; letter-spacing: 1px;">
                <span style="color: #e8e8ec;">Sky</span><span style="color: #f5a623;">Glass</span>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px;">
              ${contentHtml}
              <div style="margin-top: 24px; text-align: center;">
                <p style="color: #8a8a9a; font-size: 14px; margin: 0 0 12px;">Questions?</p>
                <a href="mailto:${SUPPORT_EMAIL}" style="color: #f5a623; text-decoration: none; font-size: 14px;">${SUPPORT_EMAIL}</a>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 40px; border-top: 1px solid #2a2a3a; text-align: center;">
              <p style="margin: 0 0 8px; color: #5a5a6a; font-size: 12px;">Built by a pilot, for pilots.</p>
              <p style="margin: 0; color: #5a5a6a; font-size: 12px;">&copy; ${currentYear} SkyGlass. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`
}

const sectionLabel = (text: string) =>
  `<div style="color: #f5a623; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">${escapeHtml(text)}</div>`

/** A boxed, monospace list of license keys. */
export function licenseKeysHtml(keys: string[]): string {
  const rows = keys
    .map(
      (key) => `
        <div style="color: #f5a623; font-family: monospace; font-size: 20px; font-weight: bold; letter-spacing: 2px; padding: 6px 0;">
          ${escapeHtml(key)}
        </div>`,
    )
    .join('')
  return `
    <div style="margin-top: 24px;">
      ${sectionLabel(keys.length > 1 ? 'Your License Keys' : 'Your License Key')}
      <table role="presentation" style="width: 100%; background-color: #1a1a24; border: 1px solid #2a2a3a; border-radius: 8px;">
        <tr>
          <td style="padding: 20px; text-align: center;">
            ${rows}
            <div style="color: #8a8a9a; font-size: 12px; margin-top: 8px;">
              Enter ${keys.length > 1 ? 'a key' : 'this key'} in the SkyGlass app when you set up your mirror.
              Each key runs one mirror at a time.
            </div>
          </td>
        </tr>
      </table>
      <div style="color: #5a5a6a; font-size: 11px; margin-top: 8px; text-align: center;">
        Keep ${keys.length > 1 ? 'these keys' : 'this key'} safe. You can move a license to another mirror at
        <a href="${MANAGE_URL}" style="color: #5a5a6a; text-decoration: underline;">skyglass.dev/license</a>.
      </div>
    </div>`
}

/** Note for kit orders: the license is written to the SD card at fulfilment. */
export function preinstalledLicenseHtml(kitCount: number): string {
  return `
    <div style="margin-top: 24px;">
      ${sectionLabel(kitCount > 1 ? 'Your Licenses' : 'Your License')}
      <table role="presentation" style="width: 100%; background-color: #1a1a24; border: 1px solid #2a2a3a; border-radius: 8px;">
        <tr>
          <td style="padding: 20px; color: #8a8a9a; font-size: 14px; line-height: 1.6; text-align: center;">
            ${kitCount > 1
              ? 'Your SkyGlass licenses come pre-installed on the SD cards in your kits.'
              : 'Your SkyGlass license comes pre-installed on the SD card in your kit.'}
            The mirror activates it automatically the first time it connects to WiFi. There is no key to type.
          </td>
        </tr>
      </table>
    </div>`
}

export function manageSignInEmailHtml(link: string): string {
  return emailLayout(
    'Manage your licenses',
    `
    <h1 style="margin: 0 0 8px; color: #e8e8ec; font-size: 24px; font-weight: bold; text-align: center;">Manage your licenses</h1>
    <p style="margin: 0 0 24px; color: #8a8a9a; font-size: 15px; text-align: center; line-height: 1.6;">
      Use this link to see your SkyGlass licenses, move one to another mirror, or get a new key.
      The link works for 30 minutes.
    </p>
    <table role="presentation" style="width: 100%;">
      <tr>
        <td style="text-align: center;">
          <a href="${escapeHtml(link)}" style="display: inline-block; padding: 14px 28px; background-color: rgba(245, 166, 35, 0.1); border: 1px solid rgba(245, 166, 35, 0.5); color: #f5a623; text-decoration: none; font-size: 14px; font-weight: 500; text-transform: uppercase; letter-spacing: 1px;">
            Manage licenses
          </a>
        </td>
      </tr>
    </table>
    <p style="margin: 24px 0 0; color: #5a5a6a; font-size: 12px; text-align: center;">
      If you didn't ask for this, you can ignore this email.
    </p>`,
  )
}

export function reissuedKeyEmailHtml(key: string): string {
  return emailLayout(
    'Your new license key',
    `
    <h1 style="margin: 0 0 8px; color: #e8e8ec; font-size: 24px; font-weight: bold; text-align: center;">Your new license key</h1>
    <p style="margin: 0; color: #8a8a9a; font-size: 15px; text-align: center; line-height: 1.6;">
      You asked for a new SkyGlass license key. Your previous key no longer works.
    </p>
    ${licenseKeysHtml([key])}`,
  )
}
