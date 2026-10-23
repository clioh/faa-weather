import { PageHeader, SEO, SiteFooter } from '../components'

export function Privacy() {
  return (
    <div className="min-h-screen bg-bg text-fg">
      <SEO
        title="Privacy Policy"
        description="SkyGlass privacy policy. Face recognition runs 100% on-device. Your biometric data never leaves your home."
        canonical="/privacy"
      />
      <PageHeader />

      <main className="page-container pt-10 pb-24 sm:pt-16">
        <h1 className="display-3">Privacy Policy</h1>
        <p className="mt-3 text-sm text-fg-3">Last updated: January 2026</p>

        <div className="prose-site mt-4 [&_ul+p]:mt-3">
          <section>
            <h2>Our Commitment to Privacy</h2>
            <p>
              SkyGlass is designed with privacy at its core. We believe your personal
              data—especially biometric data like face recognition—should stay under your control.
              This policy explains what data we collect, how we use it, and the choices you have.
            </p>
          </section>

          <section>
            <h2>Face Recognition Data</h2>
            <div className="panel mt-4 px-5 py-5 sm:px-6">
              <h3 className="mt-0">100% On-Device Processing</h3>
              <p>
                Face recognition embeddings are generated and stored entirely on your SkyGlass
                device (the Raspberry Pi). This data is <strong>never transmitted</strong> to our
                servers or any third party. You can delete your face data at any time through the
                companion app or web interface.
              </p>
            </div>
          </section>

          <section>
            <h2>Data We Collect</h2>

            <h3>When you join our waitlist:</h3>
            <ul>
              <li>Email address (required)</li>
              <li>Home airport ICAO code (optional)</li>
              <li>Timestamp of signup</li>
            </ul>

            <h3>When you use SkyGlass:</h3>
            <ul>
              <li>
                <strong>Aviation data requests:</strong> Your configured airports are sent to
                aviationweather.gov to fetch METAR/TAF data. We do not log these requests.
              </li>
              <li>
                <strong>Calendar data:</strong> If you connect Google Calendar, authentication is
                handled directly with Google. We do not store your calendar data on our servers.
              </li>
              <li>
                <strong>Anonymous analytics:</strong> We may collect anonymous usage statistics
                (e.g., feature usage, error rates) to improve the product. This data cannot be tied
                to your identity.
              </li>
            </ul>
          </section>

          <section>
            <h2>Data We Never Collect</h2>
            <ul>
              <li>Face images or biometric data</li>
              <li>Camera footage</li>
              <li>Your location (beyond airport codes you configure)</li>
              <li>Your calendar event contents</li>
            </ul>
          </section>

          <section>
            <h2>Third-Party Services</h2>
            <p>SkyGlass integrates with the following third-party services:</p>
            <ul>
              <li>
                <strong>Aviation Weather Center (aviationweather.gov):</strong> For METAR, TAF, and
                TFR data
              </li>
              <li>
                <strong>Google Calendar API:</strong> For calendar integration (optional)
              </li>
              <li>
                <strong>Sunrise-Sunset.org:</strong> For astronomical data
              </li>
            </ul>
            <p>Each service has its own privacy policy. We encourage you to review them.</p>
          </section>

          <section>
            <h2>Your Rights</h2>
            <p>You have the right to:</p>
            <ul>
              <li>Access the personal data we hold about you</li>
              <li>Request deletion of your data from our waitlist</li>
              <li>Delete all face recognition data stored on your device</li>
              <li>Opt out of anonymous analytics</li>
            </ul>
            <p>
              To exercise these rights, contact us at{' '}
              <a href="mailto:privacy@skyglass.dev">privacy@skyglass.dev</a>
            </p>
          </section>

          <section>
            <h2>Contact</h2>
            <p>
              If you have questions about this privacy policy or our data practices, please contact
              us at <a href="mailto:privacy@skyglass.dev">privacy@skyglass.dev</a>
            </p>
          </section>
        </div>
      </main>

      <SiteFooter />
    </div>
  )
}
