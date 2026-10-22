/**
 * License Setup Screen
 *
 * Second setup step (after WiFi). The customer types the key from their
 * purchase email; the mirror activates it with skyglass.dev. Pre-flashed kits
 * activate on their own, so this screen usually just confirms "License active"
 * for them. Also reached from Settings → License to change the key.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { View, StyleSheet, Pressable, ScrollView } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import { api, ApiError, type LicenseStatus } from '@/lib/api';
import {
  LICENSE_MANAGE_URL,
  STORE_URL,
  formatLicenseKeyInput,
  licenseKeyProblem,
  normalizeLicenseKey,
} from '@/lib/license';
import { logError } from '@/lib/errors';
import { KeyboardAvoidingScreen } from '@/components';
import { goBack } from '@/lib/navigation';
import { continueSetup } from '@/lib/setupSteps';
import {
  Button,
  Field,
  Footer,
  IconCircle,
  Notice,
  Row,
  RowGroup,
  SectionLabel,
  Spinner,
  Text,
  TextButton,
  type IconName,
} from '@/components/ui';
import { colors, spacing, typography, fonts, tones } from '@/lib/theme';

interface ScreenError {
  title: string;
  message: string;
  /** Offer the license management page (transfers, re-sent keys). */
  showManageLink?: boolean;
}

/** What to tell the user when the mirror rejects a key. */
function describeActivationError(err: unknown, supportEmail: string): ScreenError {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'invalid_key':
        return {
          title: 'Not a valid key',
          message:
            'License keys look like XXXX-XXXX-XXXX-XXXX. Copy the key from your order ' +
            'confirmation email and try again.',
        };
      case 'disabled':
        return {
          title: 'Licensing is off',
          message: "This mirror doesn't require a license key, so there's nothing to activate.",
        };
      case 'not_found':
        return {
          title: 'Key not recognized',
          message:
            'No SkyGlass license matches this key. Check it against your order confirmation email, ' +
            'or have the key re-sent from your license page.',
          showManageLink: true,
        };
      case 'bound_to_another_device':
        return {
          title: 'In use on another mirror',
          message:
            'This key is already activated on a different mirror. One license runs one mirror ' +
            'at a time. Release it from the other mirror on your license page, then try again here.',
          showManageLink: true,
        };
      case 'revoked':
        return {
          title: 'License revoked',
          message:
            `This license is no longer valid, usually after a refund. If that's a mistake, ` +
            `contact ${supportEmail}.`,
        };
      case 'rate_limited':
        return {
          title: 'Too many attempts',
          message: 'The license server is limiting requests from this network. Wait a while and try again.',
        };
      case 'server_error':
        return {
          title: "Mirror couldn't verify the license",
          message:
            'SkyGlass answered, but the mirror could not verify the reply. Make sure the mirror ' +
            `software is up to date, then try again. If it keeps happening, contact ${supportEmail}.`,
        };
    }
    if (err.status === undefined) {
      return {
        title: "Can't reach your mirror",
        message: 'Make sure your phone and the mirror are on the same WiFi network, then try again.',
      };
    }
    if (err.status >= 500) {
      return {
        title: "Mirror couldn't reach SkyGlass",
        message:
          'The mirror needs an internet connection to activate a key. Check its WiFi connection ' +
          'and try again.',
      };
    }
    if (err.status === 400 && !err.code) {
      return { title: 'Invalid key', message: err.message };
    }
    return { title: 'Activation failed', message: err.message };
  }
  return {
    title: 'Activation failed',
    message: err instanceof Error ? err.message : 'Something went wrong. Try again.',
  };
}

/** Kit first boot: the mirror is activating its pre-installed key. */
function isActivatingKeyFile(status: LicenseStatus | null): boolean {
  return status?.state === 'unlicensed' && !!status.keyFilePending;
}

/** One line about a problem state the mirror is already in, shown above the key field. */
function describeCurrentState(status: LicenseStatus): ScreenError | null {
  if (isActivatingKeyFile(status)) {
    return {
      title: 'Activating the pre-installed license…',
      message:
        status.message ||
        'Your kit came with a license. The mirror activates it as soon as it is online; this ' +
          'usually takes under a minute.',
    };
  }
  switch (status.state) {
    case 'expired':
      return {
        title: 'Reconnect to verify',
        message:
          "The mirror hasn't been able to check its license for over 30 days. Once it's back " +
          'online it verifies on its own, or tap Check again.',
      };
    case 'released':
      return {
        title: 'License released',
        message:
          'This license was released from this mirror. Enter the key again to bring it back here.',
        showManageLink: true,
      };
    case 'revoked':
      return {
        title: 'License revoked',
        message: `The current license is no longer valid. Enter a different key, or contact ${status.supportEmail}.`,
      };
    case 'bound_elsewhere':
      return {
        title: 'In use on another mirror',
        message:
          'The saved key is activated on a different mirror. Release it there from your license ' +
          'page, or enter a different key.',
        showManageLink: true,
      };
    default:
      return null;
  }
}

export default function LicenseSetupScreen() {
  // 'setup' when opened from the setup checklist or the WiFi step; absent
  // when opened from Settings.
  const { flow } = useLocalSearchParams<{ flow?: string }>();
  const inSetupFlow = flow === 'setup';
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [key, setKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<ScreenError | null>(null);
  /** Show the key field even though a license is active (changing keys). */
  const [changingKey, setChangingKey] = useState(false);
  /** The key was activated on this visit (vs. already active when we arrived). */
  const [justActivated, setJustActivated] = useState(false);

  const loadStatus = useCallback(async () => {
    setLoadError(null);
    try {
      setStatus(await api.getLicenseStatus());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load license status');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadStatus();
    }, [loadStatus])
  );

  // Kit first boot: ask the mirror to try its key file now, then poll until it
  // activates (or the user enters a key instead).
  const activatingKeyFile = isActivatingKeyFile(status);
  useFocusEffect(
    useCallback(() => {
      if (!activatingKeyFile) return;
      let cancelled = false;
      const poll = async () => {
        try {
          const next = await api.refreshLicense();
          if (!cancelled) setStatus(next);
        } catch (err) {
          logError('LicenseSetup.pollKeyFile', err);
        }
      };
      poll();
      const timer = setInterval(poll, 10_000);
      return () => {
        cancelled = true;
        clearInterval(timer);
      };
    }, [activatingKeyFile])
  );

  const supportEmail = status?.supportEmail || 'support@skyglass.dev';
  const manageUrl = status?.manageUrl || LICENSE_MANAGE_URL;
  const normalized = normalizeLicenseKey(key);
  const keyComplete = key.replace(/-/g, '').length >= 16;
  const keyHint = key ? licenseKeyProblem(key) : null;

  const openManagePage = () => {
    WebBrowser.openBrowserAsync(manageUrl).catch((err) => logError('LicenseSetup.openManage', err));
  };

  const openStore = () => {
    WebBrowser.openBrowserAsync(STORE_URL).catch((err) => logError('LicenseSetup.openStore', err));
  };

  /**
   * In the setup flow, hand straight over to the next incomplete step
   * (Location, Airport or Face; the checklist if they're all done). From
   * Settings, go back where we came from.
   */
  const continueOn = () => {
    if (inSetupFlow) continueSetup('license');
    else goBack('/dashboard');
  };

  // Licensing switched off (local development, SKYGLASS_LICENSE=off): the
  // walkthrough skips this step without showing it.
  const isDisabled = status?.state === 'disabled' || status?.enabled === false;
  const skipped = useRef(false);
  useEffect(() => {
    if (inSetupFlow && isDisabled && !skipped.current) {
      skipped.current = true;
      continueSetup('license');
    }
  }, [inSetupFlow, isDisabled]);

  const handleActivate = async () => {
    if (!normalized || submitting) return;
    setSubmitting(true);
    setError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await api.setLicenseKey(normalized);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setKey('');
      setChangingKey(false);
      setJustActivated(true);
      // Re-read rather than trusting the POST body, so the confirmation shows
      // exactly what the mirror now reports.
      setStatus(await api.getLicenseStatus().catch(() => status));
    } catch (err) {
      setError(describeActivationError(err, supportEmail));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      setStatus(await api.refreshLicense());
    } catch (err) {
      setError(describeActivationError(err, supportEmail));
    } finally {
      setRefreshing(false);
    }
  };

  if (loading || (inSetupFlow && isDisabled)) {
    return (
      <View style={styles.centerContainer}>
        <Spinner size="large" />
        <Text style={styles.mutedText}>Checking license...</Text>
      </View>
    );
  }

  if (loadError && !status) {
    return (
      <StatusScreen
        icon="warning-outline"
        iconColor={colors.warning}
        title="Can't reach your mirror"
        body={[
          loadError,
          inSetupFlow
            ? 'If the mirror just joined your WiFi, give it a minute to restart and make sure your ' +
              'phone is on the same network, then retry.'
            : null,
        ]}
        footer={<Button label="Retry" variant="secondary" onPress={loadStatus} />}
      />
    );
  }

  const isActive = status?.state === 'active';

  // Licensing switched off, opened from Settings: nothing to enter.
  if (isDisabled) {
    return (
      <StatusScreen
        icon="key-outline"
        iconColor={colors.textMuted}
        title="Licensing is off"
        body={["This mirror doesn't require a license key."]}
        footer={<Button label="Continue" onPress={continueOn} />}
      />
    );
  }

  // Already active (pre-flashed kit, or revisiting from Settings).
  if (isActive && !changingKey) {
    return (
      <StatusScreen
        icon="checkmark"
        accent
        title={
          <>
            License active
            {status?.keyLast4 ? <Text style={styles.titleKey}>{` (…${status.keyLast4})`}</Text> : null}
          </>
        }
        body={[
          justActivated
            ? 'Your key is activated on this mirror. Keep the email it came in: you’ll need ' +
              'the key again if you move the license to another mirror.'
            : inSetupFlow
            ? 'This mirror already has an active license, so there is no key to enter. ' +
              'Kits come with the license pre-installed.'
            : `${
                status?.activatedAt
                  ? `Activated ${new Date(status.activatedAt).toLocaleDateString()}. `
                  : ''
              }This mirror is licensed.`,
        ]}
        footer={<Button label="Continue" onPress={continueOn} />}
      >
        <RowGroup>
          <Row title="Use a different key" tone="accent" onPress={() => setChangingKey(true)} />
          <Row
            title="Manage license"
            tone="accent"
            onPress={openManagePage}
            trailing={<Ionicons name="open-outline" size={14} color={colors.chevron} />}
          />
        </RowGroup>
      </StatusScreen>
    );
  }

  const stateNotice = status ? describeCurrentState(status) : null;
  const notice = error ?? stateNotice;
  const noticeTone = error ? 'error' : 'warning';

  return (
    <KeyboardAvoidingScreen style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.instructions}>
          <View style={styles.instructionsHeader}>
            <Ionicons name="key-outline" size={18} color={colors.primary} />
            <Text style={styles.instructionsTitle}>Where's my key?</Text>
          </View>
          <Text style={styles.instructionsText}>
            It's in your SkyGlass order confirmation email, in the form{' '}
            <Text style={styles.mono}>XXXX-XXXX-XXXX-XXXX</Text>. Bought a kit? The key comes
            pre-installed and activates on its own once the mirror is online, so you shouldn't
            need to type anything.
          </Text>
        </View>

        {notice && (
          <Notice tone={noticeTone} title={notice.title} message={notice.message}>
            {notice.showManageLink && (
              <Pressable onPress={openManagePage} accessibilityRole="link" style={styles.noticeAction}>
                <Text style={styles.noticeLink}>{manageUrl.replace(/^https?:\/\//, '')}</Text>
              </Pressable>
            )}
            {!error && status?.state === 'expired' && (
              <Pressable
                onPress={handleRefresh}
                disabled={refreshing}
                style={styles.noticeAction}
                accessibilityRole="button"
              >
                {refreshing ? (
                  <Spinner color={tones[noticeTone].icon} />
                ) : (
                  <Text style={styles.noticeLink}>Check again</Text>
                )}
              </Pressable>
            )}
          </Notice>
        )}

        <View>
          <SectionLabel>LICENSE KEY</SectionLabel>
          <Field
            value={key}
            onChangeText={(text) => {
              setKey(formatLicenseKeyInput(text));
              if (error) setError(null);
            }}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            spellCheck={false}
            // 16 characters + 3 dashes
            maxLength={19}
            returnKeyType="go"
            onSubmitEditing={handleActivate}
            accessibilityLabel="License key"
            editable={!submitting}
            mono
            inputTextStyle={styles.keyInput}
            error={keyHint && (keyComplete || /[01OI]/.test(key)) ? keyHint : null}
            help={
              keyHint && (keyComplete || /[01OI]/.test(key))
                ? undefined
                : 'Dashes are added for you. Keys never contain 0, O, 1 or I.'
            }
          />
        </View>

        <RowGroup>
          <Row
            title="Lost your key or moving it from another mirror?"
            caption={`Have it re-sent or release it at ${manageUrl.replace(/^https?:\/\//, '')}`}
            tone="accent"
            onPress={openManagePage}
            style={styles.linkRow}
          />
          <Row
            title="Don't have a license?"
            caption={`Buy one at ${STORE_URL.replace(/^https?:\/\//, '')}`}
            tone="accent"
            onPress={openStore}
            style={styles.linkRow}
          />
        </RowGroup>

        {isActive && changingKey && (
          <TextButton
            label={`Keep the current key (…${status?.keyLast4})`}
            color={colors.textSecondary}
            onPress={() => setChangingKey(false)}
          />
        )}
      </ScrollView>

      <Footer>
        <Button
          label="Activate"
          icon="key-outline"
          onPress={handleActivate}
          disabled={!normalized}
          loading={submitting}
        />
      </Footer>
    </KeyboardAvoidingScreen>
  );
}

interface StatusScreenProps {
  icon: IconName;
  iconColor?: string;
  /** Accent-outlined circle (success). */
  accent?: boolean;
  title: ReactNode;
  body: (string | null)[];
  children?: ReactNode;
  footer: ReactNode;
}

/** Icon, title and text at the top, actions pinned in the footer. */
function StatusScreen({ icon, iconColor, accent, title, body, children, footer }: StatusScreenProps) {
  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.statusContent}>
        <IconCircle icon={icon} color={iconColor} style={accent ? styles.accentCircle : undefined} />
        <View style={styles.statusText}>
          <Text style={styles.statusTitle} accessibilityRole="header">
            {title}
          </Text>
          {body.filter(Boolean).map((line) => (
            <Text key={line} style={styles.statusBody}>
              {line}
            </Text>
          ))}
        </View>
        {children}
      </ScrollView>
      <Footer>{footer}</Footer>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    gap: 20,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.background,
  },
  mutedText: {
    ...typography.bodySmall,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  statusContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: 48,
    paddingBottom: spacing.lg,
    gap: spacing.lg,
  },
  accentCircle: {
    borderColor: colors.primary,
  },
  statusText: {
    gap: 10,
  },
  statusTitle: {
    ...typography.h1,
    color: colors.text,
  },
  titleKey: {
    fontFamily: fonts.mono,
    fontSize: 20,
    color: colors.textSecondary,
  },
  statusBody: {
    ...typography.body,
    color: colors.textSecondary,
  },
  instructions: {
    gap: 12,
    padding: spacing.md,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.sheetBorder,
    backgroundColor: colors.surfaceTint,
  },
  instructionsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  instructionsTitle: {
    fontSize: 15,
    color: colors.text,
  },
  instructionsText: {
    fontSize: 13,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  mono: {
    fontFamily: fonts.mono,
  },
  noticeAction: {
    minHeight: 28,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  noticeLink: {
    fontSize: 13,
    color: colors.primary,
  },
  keyInput: {
    fontSize: 18,
    letterSpacing: 1,
  },
  linkRow: {
    minHeight: 56,
  },
});
