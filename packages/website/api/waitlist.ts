import type { VercelRequest, VercelResponse } from '@vercel/node'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

// Resend Audience ID for the waitlist (create this in Resend dashboard)
const AUDIENCE_ID = process.env.RESEND_AUDIENCE_ID

interface WaitlistEntry {
  email: string
  airport?: string
  timestamp: string
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { email, airport } = req.body

    // Validate email
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email is required' })
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' })
    }

    // Validate airport code if provided
    if (airport && (typeof airport !== 'string' || airport.length > 4)) {
      return res.status(400).json({ error: 'Invalid airport code' })
    }

    const entry: WaitlistEntry = {
      email: email.toLowerCase().trim(),
      airport: airport?.toUpperCase().trim() || undefined,
      timestamp: new Date().toISOString(),
    }

    // Add to Resend Audience (contact list)
    if (AUDIENCE_ID) {
      try {
        await resend.contacts.create({
          audienceId: AUDIENCE_ID,
          email: entry.email,
          firstName: entry.airport || '', // Store airport in firstName field for now
          unsubscribed: false,
        })
      } catch (contactError: unknown) {
        // Contact might already exist, that's ok
        const error = contactError as { message?: string }
        console.log(`[Waitlist] Contact create note: ${error.message || 'Unknown'}`)
      }
    }

    // Send welcome email
    const { error: emailError } = await resend.emails.send({
      from: 'SkyGlass <hello@skyglass.dev>',
      to: entry.email,
      subject: "You're on the SkyGlass waitlist",
      html: getWelcomeEmailHtml(entry),
    })

    if (emailError) {
      console.error('[Waitlist] Email error:', emailError)
      // Don't fail the whole request if email fails
    }

    console.log(
      `[Waitlist] New signup: ${entry.email}${entry.airport ? ` (${entry.airport})` : ''}`
    )

    return res.status(200).json({
      success: true,
      message: 'Successfully joined the waitlist',
      position: Math.floor(Math.random() * 50) + 100, // Placeholder position
    })
  } catch (error) {
    console.error('[Waitlist] Error:', error)
    return res.status(500).json({ error: 'Internal server error' })
  }
}

function getWelcomeEmailHtml(entry: WaitlistEntry): string {
  const currentYear = new Date().getFullYear()

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to the SkyGlass Waitlist</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0a0a0f; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 560px; margin: 0 auto; background-color: #12121a; border: 1px solid #2a2a3a; border-radius: 12px;">

          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center; border-bottom: 1px solid #2a2a3a;">
              <div style="font-size: 24px; font-weight: bold; letter-spacing: 1px;">
                <span style="color: #e8e8ec;">Sky</span><span style="color: #f5a623;">Glass</span>
              </div>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 40px;">
              <h1 style="margin: 0 0 16px; color: #e8e8ec; font-size: 28px; font-weight: bold; text-align: center;">
                You're on the list
              </h1>
              <p style="margin: 0 0 24px; color: #8a8a9a; font-size: 16px; line-height: 1.6; text-align: center;">
                Thanks for joining the SkyGlass waitlist. We'll let you know as soon as kits are ready to ship.
              </p>

              <!-- Status Card -->
              <table role="presentation" style="width: 100%; background-color: #1a1a24; border: 1px solid #2a2a3a; border-radius: 8px; margin-bottom: 24px;">
                <tr>
                  <td style="padding: 20px;">
                    <table role="presentation" style="width: 100%;">
                      <tr>
                        <td style="width: 12px;">
                          <div style="width: 8px; height: 8px; background-color: #4ade80; border-radius: 50%;"></div>
                        </td>
                        <td style="padding-left: 12px;">
                          <span style="color: #4ade80; font-family: monospace; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">
                            Status: Confirmed
                          </span>
                        </td>
                      </tr>
                    </table>
                    ${
                      entry.airport
                        ? `
                    <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #2a2a3a;">
                      <span style="color: #8a8a9a; font-size: 12px;">Home Airport:</span>
                      <span style="color: #f5a623; font-family: monospace; font-size: 14px; margin-left: 8px;">${entry.airport}</span>
                    </div>
                    `
                        : ''
                    }
                  </td>
                </tr>
              </table>

              <!-- What's Next -->
              <h2 style="margin: 0 0 16px; color: #e8e8ec; font-size: 18px; font-weight: 600;">
                What's next?
              </h2>
              <ul style="margin: 0 0 24px; padding-left: 20px; color: #8a8a9a; font-size: 14px; line-height: 1.8;">
                <li>We're finalizing production and testing</li>
                <li>Waitlist members get first access when we launch</li>
                <li>You'll receive an email when pre-orders open</li>
              </ul>

              <!-- CTA -->
              <table role="presentation" style="width: 100%;">
                <tr>
                  <td style="text-align: center;">
                    <a href="https://skyglass.dev" style="display: inline-block; padding: 14px 28px; background-color: rgba(245, 166, 35, 0.1); border: 1px solid rgba(245, 166, 35, 0.5); color: #f5a623; text-decoration: none; font-size: 14px; font-weight: 500; text-transform: uppercase; letter-spacing: 1px;">
                      Visit SkyGlass
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 40px; border-top: 1px solid #2a2a3a; text-align: center;">
              <p style="margin: 0 0 8px; color: #5a5a6a; font-size: 12px;">
                Built by a pilot, for pilots.
              </p>
              <p style="margin: 0; color: #5a5a6a; font-size: 12px;">
                &copy; ${currentYear} SkyGlass. All rights reserved.
              </p>
              <p style="margin: 16px 0 0; color: #5a5a6a; font-size: 11px;">
                <a href="https://skyglass.dev/privacy" style="color: #5a5a6a; text-decoration: underline;">Privacy Policy</a>
                &nbsp;&middot;&nbsp;
                <a href="https://skyglass.dev/terms" style="color: #5a5a6a; text-decoration: underline;">Terms</a>
              </p>
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
