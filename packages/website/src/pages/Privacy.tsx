import { PageHeader, SEO, SiteFooter } from '../components'

export function Privacy() {
  return (
    <div className="min-h-screen bg-bg text-fg">
      <SEO
        title="Privacy Policy"
        description="What SkyGlass keeps on your mirror, what it sends and to whom, and what we store when you buy, join the waitlist or activate a license."
        canonical="/privacy"
      />
      <PageHeader />

      <main className="page-container pt-10 pb-24 sm:pt-16">
        <h1 className="display-3">Privacy policy</h1>
        <p className="mt-3 text-sm text-fg-3">Last updated: October 2026</p>

        <div className="prose-site mt-4 [&_ul+p]:mt-3">
          <section>
            <h2>The short version</h2>
            <ul>
              <li>
                Your face data, camera images, calendars and calendar sign-ins stay on your mirror.
                We never receive them.
              </li>
              <li>
                Your mirror talks to SkyGlass (skyglass.dev) for four things: checking its license,
                calendar sign-in, NOTAMs and stock quotes. Everything else it fetches straight from
                public data sources or from the calendar services you connect.
              </li>
              <li>
                When you buy, join the waitlist or manage a license, we keep your email address and
                what we need to deliver and support your order.
              </li>
              <li>We don't sell personal data and the site has no advertising trackers.</li>
            </ul>
          </section>

          <section>
            <h2>What stays on your mirror</h2>
            <div className="panel mt-4 px-5 py-5 sm:px-6">
              <h3 className="mt-0">Presence and face recognition run on the device</h3>
              <p>
                The camera feed is processed on the Raspberry Pi. Face encodings for the people you
                enroll are stored on the Pi and are never sent to us or anyone else. You can remove
                a person, and their face data, from the SkyGlass app.
              </p>
            </div>
            <p>Also stored only on the mirror:</p>
            <ul>
              <li>The people on the mirror, their layouts and widget settings</li>
              <li>
                Calendar accounts: Google and Microsoft sign-in tokens, iCloud and CalDAV
                app-specific passwords, and calendar (ICS) links
              </li>
              <li>Calendar events and imported airline schedules</li>
              <li>To-dos, photos and the mirror's home location and airport</li>
              <li>The license key and the signed license token</li>
            </ul>
          </section>

          <section>
            <h2>What your mirror sends to SkyGlass</h2>
            <p>
              These requests go to skyglass.dev, which is hosted on Vercel. Like any web request,
              each one carries the mirror's public IP address.
            </p>
            <ul>
              <li>
                <strong>License check:</strong> when you activate a license and about once a day
                after that, the mirror sends its license key, a device fingerprint (on a Raspberry
                Pi, the board's serial number; on other hardware, a hash of the machine ID and
                network address), the mirror's random ID and the SkyGlass version it runs.
              </li>
              <li>
                <strong>Google Calendar sign-in:</strong> Google doesn't allow its client secret on
                devices, so the mirror exchanges the sign-in code, and later refreshes its access,
                through skyglass.dev. The code and tokens pass through to Google and back to the
                mirror. We don't store or log them, and calendar events never pass through us.
              </li>
              <li>
                <strong>Calendar setup:</strong> the mirror fetches the public Google and Microsoft
                app IDs from skyglass.dev. Nothing about you is sent.
              </li>
              <li>
                <strong>NOTAMs:</strong> the airport code (for example KSAN). We fetch the NOTAMs
                from the FAA and return them; the FAA sees our server, not your mirror.
              </li>
              <li>
                <strong>Stock quotes:</strong> the ticker symbols in your stocks widget. We fetch
                the quotes from Finnhub. If skyglass.dev can't be reached, the mirror asks Yahoo
                Finance directly instead.
              </li>
            </ul>
          </section>

          <section>
            <h2>What your mirror fetches directly</h2>
            <p>
              These go from the mirror to the source, not through us. Each source sees the mirror's
              IP address and the request.
            </p>
            <ul>
              <li>
                <strong>Aviation Weather Center (aviationweather.gov):</strong> METAR, TAF and winds
                aloft for your airports
              </li>
              <li>
                <strong>FAA (tfr.faa.gov):</strong> the list and shapes of active TFRs
              </li>
              <li>
                <strong>Open-Meteo:</strong> the weather forecast, using the mirror's location
                rounded to about 1 km
              </li>
              <li>
                <strong>RainViewer and Esri (ArcGIS):</strong> radar images and the base map for the
                area the radar widget shows
              </li>
              <li>
                <strong>CoinGecko:</strong> prices for the coins in a crypto widget
              </li>
              <li>
                <strong>News feeds:</strong> the RSS feeds you pick (BBC News, NPR, CNBC, Ars
                Technica, ESPN, AVweb)
              </li>
              <li>
                <strong>Calendars you connect:</strong> Google, Microsoft (sign-in uses Microsoft's
                device code, entered on a Microsoft page), iCloud or another CalDAV server, or the
                address of a calendar link
              </li>
              <li>
                <strong>GitHub:</strong> checks for, and downloads, SkyGlass updates
              </li>
            </ul>
            <p>
              Sunrise, sunset, twilight and moon times are calculated on the mirror. They need no
              network request.
            </p>
          </section>

          <section>
            <h2>The phone app</h2>
            <p>
              The SkyGlass app talks to your mirror over your local network. Pairing gives your
              phone a token that only your mirror checks. The app has no SkyGlass account and sends
              nothing to us. Invite links (skyglass.dev/invite) keep the mirror's address and invite
              code after the # in the link, which browsers never send to a server; the page only
              hands them to the app.
            </p>
          </section>

          <section>
            <h2>When you visit skyglass.dev</h2>
            <ul>
              <li>
                <strong>Vercel Web Analytics:</strong> counts page views without cookies. Sign-in
                and invite codes are removed from page addresses before anything is counted.
              </li>
              <li>
                <strong>Google Fonts:</strong> the site's fonts load from Google, which sees your IP
                address.
              </li>
              <li>
                <strong>Your cart</strong> is kept in your browser's local storage until you check
                out or clear it.
              </li>
              <li>
                <strong>Hosting logs:</strong> Vercel keeps request logs, which include IP
                addresses, for a limited time under its own retention policy.
              </li>
            </ul>
          </section>

          <section>
            <h2>The waitlist</h2>
            <p>
              If you join the waitlist we store your email address as a contact with Resend, our
              email provider, and use it to send one email when pre-orders open. That email has an
              unsubscribe link. The address stays on the list until you unsubscribe or ask us to
              remove it.
            </p>
          </section>

          <section>
            <h2>When you buy</h2>
            <ul>
              <li>
                <strong>Stripe</strong> processes payments. Card details go to Stripe directly; we
                never see or store them. Stripe also calculates sales tax from your shipping
                address, or from your ZIP code for a license-only order.
              </li>
              <li>
                Stripe keeps your order for us: email address, name, shipping address (for kits),
                items, amounts and any promo code.
              </li>
              <li>
                <strong>Resend</strong> sends the order confirmation, license keys and license
                sign-in links.
              </li>
            </ul>
          </section>

          <section>
            <h2>License records</h2>
            <p>
              Licenses are kept in our database (Neon Postgres). For each license we store the email
              address and order it came from, the product, a hash of the key and its last four
              characters, its status, and, once it's activated, the device fingerprint, the mirror's
              ID, the SkyGlass version, and when it was activated and last checked in. Each time a
              license is moved to another mirror we record the old device fingerprint and the date,
              to apply the transfer limit. We also record which order used a promo code.
            </p>
            <p>
              To stop abuse, some requests (license checks, checkout, promo codes, the waitlist and
              license sign-in) are counted per IP address, and sign-in and waitlist requests also
              per email address. These counters are deleted after about a day.
            </p>
            <p>
              We have no automatic deletion schedule for order and license records: we keep them so
              the license keeps working and can be transferred, refunded or supported. Ask us and
              we'll delete what we don't need to keep for tax and accounting.
            </p>
          </section>

          <section>
            <h2>Who else handles data for us</h2>
            <ul>
              <li>Vercel: website and API hosting, analytics</li>
              <li>Neon: the license database</li>
              <li>Stripe: payments and sales tax</li>
              <li>Resend: email and the waitlist</li>
              <li>
                Google, the FAA and Finnhub: the upstream services behind calendar sign-in, NOTAMs
                and stock quotes
              </li>
            </ul>
            <p>Each has its own privacy policy.</p>
          </section>

          <section>
            <h2>Your choices</h2>
            <ul>
              <li>
                Remove a person and their face data, or a calendar account, in the SkyGlass app
              </li>
              <li>Leave the waitlist with the unsubscribe link, or by emailing us</li>
              <li>Ask for a copy of, or the deletion of, the data we hold about you</li>
            </ul>
            <p>
              Email <a href="mailto:privacy@skyglass.dev">privacy@skyglass.dev</a> for any of these.
            </p>
          </section>

          <section>
            <h2>Changes</h2>
            <p>
              If what SkyGlass collects changes, we'll update this page and the date at the top.
            </p>
          </section>

          <section>
            <h2>Contact</h2>
            <p>
              Questions about privacy:{' '}
              <a href="mailto:privacy@skyglass.dev">privacy@skyglass.dev</a>
            </p>
          </section>
        </div>
      </main>

      <SiteFooter />
    </div>
  )
}
