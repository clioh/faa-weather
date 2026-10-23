import { Link } from 'react-router-dom'
import { PageHeader, SEO, SiteFooter } from '../components'

export function Terms() {
  return (
    <div className="min-h-screen bg-bg text-fg">
      <SEO
        title="Terms of Service"
        description="SkyGlass terms of service. Important: SkyGlass is for entertainment only, not for flight planning or aviation decision-making."
        canonical="/terms"
      />
      <PageHeader />

      <main className="page-container pt-10 pb-24 sm:pt-16">
        <h1 className="display-3">Terms of Service</h1>
        <p className="mt-3 text-sm text-fg-3">Last updated: October 21, 2026</p>

        <div className="prose-site mt-4 [&_ul+p]:mt-3">
          <section>
            <h2>Agreement to Terms</h2>
            <p>
              By accessing or using SkyGlass products and services, you agree to be bound by these
              Terms of Service. If you do not agree to these terms, please do not use our products.
            </p>
          </section>

          <section>
            <h2>Important Disclaimer</h2>
            <div className="notice notice-warning mt-4 px-5 py-5 sm:px-6">
              <h3 className="mt-0">Not for Flight Planning</h3>
              <p>
                SkyGlass is a consumer entertainment and lifestyle product. It is{' '}
                <strong>NOT</strong> intended to be used for flight planning, pre-flight briefings,
                or any aviation decision-making. Always use official sources (1800wxbrief.com,
                ForeFlight, etc.) and follow FAA regulations for proper flight planning. Weather
                data displayed on SkyGlass may be delayed, incomplete, or inaccurate.
              </p>
            </div>
          </section>

          <section>
            <h2>Product Description</h2>
            <p>
              SkyGlass is a smart mirror that displays aviation weather information, calendar data,
              and other information for entertainment and convenience purposes. The product
              includes:
            </p>
            <ul>
              <li>
                Hardware, where purchased (Raspberry Pi and camera; the Complete Kit adds the
                display, two-way mirror glass, and frame)
              </li>
              <li>SkyGlass software and a license for one mirror</li>
              <li>Companion mobile app</li>
              <li>Web-based configuration interface</li>
            </ul>
          </section>

          <section>
            <h2>Waitlist & Pre-Orders</h2>
            <p>
              By joining our waitlist, you are expressing interest in SkyGlass. This does not
              constitute a purchase or guarantee availability. When pre-orders open:
            </p>
            <ul>
              <li>Waitlist members will be notified in order of signup</li>
              <li>Pricing and specifications may change before final release</li>
              <li>
                Pre-orders are refundable in full until the product ships (see{' '}
                <a href="#refunds">Refunds & Returns</a>)
              </li>
            </ul>
          </section>

          <section>
            <h2>Software License</h2>
            <p>
              The SkyGlass software is licensed, not sold. Each license (sold on its own or
              pre-installed with a kit) grants you a non-exclusive license to run the software on
              one mirror at a time. A license is bound to the device it is activated on;
              reinstalling the software on the same device does not use up a license.
            </p>
            <p>
              You may move a license to a different mirror by releasing it from the current one at{' '}
              <Link to="/license">skyglass.dev/license</Link>, up to 3 times in any 12-month period.
              Beyond that, contact <a href="mailto:support@skyglass.dev">support@skyglass.dev</a>. A
              refund or chargeback revokes the license (see <a href="#refunds">Refunds & Returns</a>
              ). You may not:
            </p>
            <ul>
              <li>
                Redistribute or sublicense the software, or share a license key across mirrors
              </li>
              <li>Reverse engineer or decompile the software</li>
              <li>Remove any copyright or proprietary notices</li>
              <li>Use the software for commercial purposes without written permission</li>
            </ul>
          </section>

          <section id="refunds" className="scroll-mt-8">
            <h2>Refunds & Returns</h2>
            <p>If SkyGlass isn't right for you, here is how refunds and returns work.</p>

            <h3>Software License</h3>
            <p>
              Ask within 30 days of purchase and we'll refund it in full, no questions asked. The
              license is revoked when the refund is issued. A mirror using it stops running SkyGlass
              at its next license check, which is normally within a day and never more than 30 days
              later if the mirror is offline.
            </p>

            <h3>Hardware Kit and Complete Kit</h3>
            <p>
              You can return a kit within 30 days of delivery for a full refund of the product
              price.
            </p>
            <ul>
              <li>
                Send back everything that came in the box, undamaged. Normal handling during setup
                is fine.
              </li>
              <li>
                You pay return shipping, unless the kit arrived defective or damaged or we sent the
                wrong item. In those cases we'll email you a prepaid return label.
              </li>
              <li>
                The original shipping charge isn't refundable, unless the return is our fault.
              </li>
              <li>There is no restocking fee.</li>
              <li>Sales tax charged on a refunded item is refunded with it.</li>
              <li>
                Each kit comes with a license pre-installed. Returning the kit revokes that license.
              </li>
            </ul>
            <p>
              Sometimes we settle a problem with a partial refund instead, such as a credit for a
              missing accessory. A partial refund doesn't affect your license.
            </p>

            <h3>Pre-Orders</h3>
            <p>
              You can cancel a pre-order for a full refund, including shipping and tax, any time
              before it ships. Once it ships, the kit return terms above apply.
            </p>

            <h3>How to Request a Refund</h3>
            <p>
              Email <a href="mailto:support@skyglass.dev">support@skyglass.dev</a> with your order
              number. For a return we'll reply with where to send it; for a damaged or defective
              item, please include photos. Refunds go back to your original payment method, usually
              within 5–10 business days after we approve a license refund or receive your returned
              kit. Your bank may take a little longer to show it.
            </p>

            <h3>Chargebacks</h3>
            <p>
              If something is wrong with your order, please contact us before disputing the charge
              with your bank or card issuer. We can usually fix it faster. A chargeback revokes the
              licenses on that order.
            </p>
          </section>

          <section id="warranty" className="scroll-mt-8">
            <h2>Hardware Warranty</h2>
            <p>
              The components we supply in the Hardware Kit and Complete Kit are covered for one year
              from delivery against defects in materials and workmanship under normal use. If a
              covered part fails, we'll repair or replace it, at our option. To make a claim, email{' '}
              <a href="mailto:support@skyglass.dev">support@skyglass.dev</a> with your order number
              and a description of the problem. If we need the part back, we pay shipping for
              covered claims.
            </p>
            <p>The warranty does not cover:</p>
            <ul>
              <li>Physical damage, such as drops or cracked glass after delivery</li>
              <li>Water or other liquid damage</li>
              <li>Modification, misuse, or improper installation</li>
              <li>Normal wear and tear, or damage from power surges</li>
              <li>
                Parts you supply yourself, such as the mirror glass, frame, and display used with
                the Hardware Kit
              </li>
              <li>Software and third-party services, which are supported separately</li>
            </ul>
            <p>
              <strong>Glass broken in transit:</strong> if the two-way mirror glass in your Complete
              Kit arrives broken, tell us within 7 days of delivery and send photos of the glass and
              the packaging. We'll replace it at no cost.
            </p>
            <p>
              This warranty is in addition to any rights you have under consumer protection law.
            </p>
          </section>

          <section>
            <h2>Limitation of Liability</h2>
            <p>
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, SKYGLASS SHALL NOT BE LIABLE FOR ANY INDIRECT,
              INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO
              LOSS OF PROFITS, DATA, OR USE, ARISING OUT OF OR RELATED TO YOUR USE OF THE PRODUCT.
            </p>
            <p>IN NO EVENT SHALL OUR TOTAL LIABILITY EXCEED THE AMOUNT YOU PAID FOR THE PRODUCT.</p>
          </section>

          <section>
            <h2>Data Sources</h2>
            <p>
              Aviation weather data is sourced from the Aviation Weather Center
              (aviationweather.gov), a service of NOAA's National Weather Service. We are not
              responsible for the accuracy, completeness, or timeliness of this data. Data may be
              delayed up to 5 minutes or more.
            </p>
          </section>

          <section>
            <h2>Changes to Terms</h2>
            <p>
              We reserve the right to modify these terms at any time. We will notify users of
              material changes via email or through the product interface. Continued use of the
              product after changes constitutes acceptance of the new terms.
            </p>
          </section>

          <section>
            <h2>Contact</h2>
            <p>
              For questions about these terms, please contact us at{' '}
              <a href="mailto:legal@skyglass.dev">legal@skyglass.dev</a>
            </p>
          </section>
        </div>
      </main>

      <SiteFooter />
    </div>
  )
}
