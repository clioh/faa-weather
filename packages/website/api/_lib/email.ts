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

/** The Resend client, or null when RESEND_API_KEY is not configured. */
export function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null
  if (!client) client = new Resend(process.env.RESEND_API_KEY)
  return client
}

/** Send an email. Returns false (and logs) on any failure; never throws. */
export async function sendEmail(opts: {
  from?: string
  to: string
  subject: string
  html: string
}): Promise<boolean> {
  const r = getResend()
  if (!r) {
    console.error('[Email] RESEND_API_KEY not configured, not sending:', opts.subject)
    return false
  }
  try {
    const { error } = await r.emails.send({
      from: opts.from ?? ORDERS_FROM,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    })
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

/**
 * Glass Cockpit email palette (docs/design/DESIGN_SYSTEM.md). Email clients
 * need inline styles, and some (older Outlook) drop rgba(), so every colour is
 * a solid hex: the site's translucent whites composited on black.
 */
export const EMAIL = {
  bg: '#000000',
  fg: '#ffffff',
  fg2: '#adadad', // rgba(255,255,255,0.68) on black
  fg3: '#949494', // rgba(255,255,255,0.58) on black
  line: '#242424', // rgba(255,255,255,0.14) on black
  accent: '#7ad7ff',
  onAccent: '#00141f',
  sans: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, Menlo, Consolas, 'Courier New', monospace",
} as const

/** Black SkyGlass email shell: wordmark, content, support line, footer. */
export function emailLayout(title: string, contentHtml: string): string {
  const currentYear = new Date().getFullYear()
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>${escapeHtml(title)} - SkyGlass</title>
</head>
<body style="margin: 0; padding: 0; background-color: ${EMAIL.bg}; color: ${EMAIL.fg}; font-family: ${EMAIL.sans};">
  <table role="presentation" width="100%" bgcolor="${EMAIL.bg}" style="width: 100%; border-collapse: collapse; background-color: ${EMAIL.bg};">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" width="100%" style="max-width: 560px; margin: 0 auto; border-collapse: collapse;">
          <tr>
            <td style="padding: 0 0 24px; border-bottom: 1px solid ${EMAIL.line};">
              <span style="color: ${EMAIL.fg}; font-family: ${EMAIL.sans}; font-size: 18px; font-weight: 500; letter-spacing: 0.02em;">SkyGlass</span>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px 0;">
              ${contentHtml}
              <p style="margin: 32px 0 0; color: ${EMAIL.fg2}; font-family: ${EMAIL.sans}; font-size: 14px; line-height: 1.6;">
                Questions? <a href="mailto:${SUPPORT_EMAIL}" style="color: ${EMAIL.accent}; text-decoration: none;">${SUPPORT_EMAIL}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 0 0; border-top: 1px solid ${EMAIL.line}; color: ${EMAIL.fg3}; font-family: ${EMAIL.sans}; font-size: 12px; line-height: 1.6;">
              Built by a pilot, for pilots. &copy; ${currentYear} SkyGlass.<br>
              <a href="https://skyglass.dev/privacy" style="color: ${EMAIL.fg3}; text-decoration: underline;">Privacy</a>
              &nbsp;&middot;&nbsp;
              <a href="https://skyglass.dev/terms" style="color: ${EMAIL.fg3}; text-decoration: underline;">Terms</a>
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

/** Large light heading. */
export const emailHeading = (text: string) =>
  `<h1 style="margin: 0 0 12px; color: ${EMAIL.fg}; font-family: ${EMAIL.sans}; font-size: 28px; font-weight: 300; letter-spacing: -0.02em; line-height: 1.2;">${escapeHtml(text)}</h1>`

/** Body paragraph (`html` is inserted as is; escape any user input first). */
export const emailParagraph = (html: string) =>
  `<p style="margin: 0 0 16px; color: ${EMAIL.fg2}; font-family: ${EMAIL.sans}; font-size: 15px; line-height: 1.6;">${html}</p>`

/** Small accent label above a section. */
export const sectionLabel = (text: string) =>
  `<div style="color: ${EMAIL.accent}; font-family: ${EMAIL.sans}; font-size: 11px; text-transform: uppercase; letter-spacing: 0.14em; margin-bottom: 8px;">${escapeHtml(text)}</div>`

/** Pill button in the accent colour. */
export const emailButton = (href: string, label: string) => `
    <table role="presentation" style="border-collapse: collapse; margin: 8px 0 16px;">
      <tr>
        <td bgcolor="${EMAIL.accent}" style="background-color: ${EMAIL.accent}; border-radius: 26px;">
          <a href="${escapeHtml(href)}" style="display: inline-block; padding: 14px 26px; color: ${EMAIL.onAccent}; font-family: ${EMAIL.sans}; font-size: 15px; font-weight: 500; text-decoration: none;">${escapeHtml(label)}</a>
        </td>
      </tr>
    </table>`

/** Hairline-bordered box. */
export const emailPanel = (innerHtml: string) => `
      <table role="presentation" width="100%" style="width: 100%; border-collapse: separate; border: 1px solid ${EMAIL.line}; border-radius: 14px;">
        <tr>
          <td style="padding: 20px;">
            ${innerHtml}
          </td>
        </tr>
      </table>`

/** A boxed, monospace list of license keys. */
export function licenseKeysHtml(keys: string[]): string {
  const rows = keys
    .map(
      (key) => `
            <div style="color: ${EMAIL.fg}; font-family: ${EMAIL.mono}; font-size: 20px; font-weight: 500; letter-spacing: 0.08em; padding: 6px 0;">
              ${escapeHtml(key)}
            </div>`
    )
    .join('')
  return `
    <div style="margin-top: 24px;">
      ${sectionLabel(keys.length > 1 ? 'Your license keys' : 'Your license key')}
      ${emailPanel(`${rows}
            <div style="color: ${EMAIL.fg2}; font-family: ${EMAIL.sans}; font-size: 13px; line-height: 1.6; margin-top: 8px;">
              Enter ${keys.length > 1 ? 'a key' : 'this key'} in the SkyGlass app when you set up your mirror.
              Each key runs one mirror at a time.
            </div>`)}
      <div style="color: ${EMAIL.fg3}; font-family: ${EMAIL.sans}; font-size: 12px; line-height: 1.6; margin-top: 8px;">
        Keep ${keys.length > 1 ? 'these keys' : 'this key'} safe. You can move a license to another mirror at
        <a href="${MANAGE_URL}" style="color: ${EMAIL.fg3}; text-decoration: underline;">skyglass.dev/license</a>.
      </div>
    </div>`
}

/** Note for kit orders: the license is written to the SD card at fulfilment. */
export function preinstalledLicenseHtml(kitCount: number): string {
  return `
    <div style="margin-top: 24px;">
      ${sectionLabel(kitCount > 1 ? 'Your licenses' : 'Your license')}
      ${emailPanel(`<div style="color: ${EMAIL.fg2}; font-family: ${EMAIL.sans}; font-size: 14px; line-height: 1.6;">
            ${
              kitCount > 1
                ? 'Your SkyGlass licenses come pre-installed on the SD cards in your kits.'
                : 'Your SkyGlass license comes pre-installed on the SD card in your kit.'
            }
            The mirror activates it automatically the first time it connects to WiFi. There is no key to type.
          </div>`)}
    </div>`
}

export function manageSignInEmailHtml(link: string): string {
  return emailLayout(
    'Manage your licenses',
    `
    ${emailHeading('Manage your licenses')}
    ${emailParagraph('Use this link to see your SkyGlass licenses, move one to another mirror, or get a new key. The link works for 30 minutes.')}
    ${emailButton(link, 'Manage licenses')}
    <p style="margin: 0; color: ${EMAIL.fg3}; font-family: ${EMAIL.sans}; font-size: 12px;">
      If you didn't ask for this, you can ignore this email.
    </p>`
  )
}

export function reissuedKeyEmailHtml(key: string): string {
  return emailLayout(
    'Your new license key',
    `
    ${emailHeading('Your new license key')}
    ${emailParagraph('You asked for a new SkyGlass license key. Your previous key no longer works.')}
    ${licenseKeysHtml([key])}`
  )
}
