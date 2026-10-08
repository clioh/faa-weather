/**
 * License Invalid Screen
 *
 * Displayed when the license is bound to another device.
 * Shows support contact information.
 */

interface LicenseInvalidScreenProps {
  supportEmail?: string;
}

export function LicenseInvalidScreen({
  supportEmail = 'support@magicmirror.dev',
}: LicenseInvalidScreenProps) {
  return (
    <div style={styles.container}>
      <div style={styles.content}>
        {/* Icon */}
        <div style={styles.iconWrapper}>
          <svg
            width="80"
            height="80"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#ef4444"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>

        {/* Title */}
        <h1 style={styles.title}>License Invalid</h1>

        {/* Message Card */}
        <div style={styles.card}>
          <p style={styles.message}>
            This license is already activated on another device.
          </p>

          <div style={styles.divider} />

          <p style={styles.instruction}>
            If you believe this is an error or need to transfer your license
            to this device, please contact support.
          </p>

          {/* Support Contact */}
          <div style={styles.supportSection}>
            <span style={styles.supportLabel}>Contact Support</span>
            <a href={`mailto:${supportEmail}`} style={styles.supportEmail}>
              {supportEmail}
            </a>
          </div>

          {/* Info Box */}
          <div style={styles.infoBox}>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#6b7280"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flexShrink: 0 }}
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <span style={styles.infoText}>
              Each license can only be activated on one device at a time.
              Support can help reset your license if needed.
            </span>
          </div>
        </div>

        {/* Footer */}
        <div style={styles.footer}>
          <span style={styles.footerText}>MagicMirror</span>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    background: '#000',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2rem',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  content: {
    maxWidth: '500px',
    width: '100%',
    textAlign: 'center',
  },
  iconWrapper: {
    marginBottom: '1.5rem',
    opacity: 0.9,
  },
  title: {
    fontSize: '2.5rem',
    fontWeight: 300,
    margin: '0 0 2rem',
    letterSpacing: '0.02em',
    color: '#ef4444',
  },
  card: {
    background: '#111',
    borderRadius: '24px',
    padding: '2.5rem',
    marginBottom: '2rem',
    border: '1px solid #1f1f1f',
  },
  message: {
    fontSize: '1.1rem',
    color: '#e5e5e5',
    lineHeight: 1.6,
    margin: '0 0 1.5rem',
  },
  divider: {
    height: '1px',
    background: '#222',
    margin: '1.5rem 0',
  },
  instruction: {
    fontSize: '0.95rem',
    color: '#9ca3af',
    lineHeight: 1.6,
    margin: '0 0 1.5rem',
  },
  supportSection: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.5rem',
    margin: '1.5rem 0',
  },
  supportLabel: {
    fontSize: '0.75rem',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
  },
  supportEmail: {
    display: 'inline-block',
    background: '#1a1a1a',
    padding: '0.75rem 1.5rem',
    borderRadius: '12px',
    color: '#4ecca3',
    fontFamily: 'monospace',
    fontSize: '1.1rem',
    textDecoration: 'none',
    transition: 'all 0.2s ease',
    border: '1px solid transparent',
  },
  infoBox: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.75rem',
    background: '#0a0a0a',
    padding: '1rem',
    borderRadius: '12px',
    marginTop: '1.5rem',
    textAlign: 'left',
  },
  infoText: {
    fontSize: '0.85rem',
    color: '#6b7280',
    lineHeight: 1.5,
  },
  footer: {
    marginTop: '2rem',
    opacity: 0.4,
  },
  footerText: {
    fontSize: '0.9rem',
    letterSpacing: '0.1em',
  },
};
