/**
 * License Setup Screen
 *
 * Second setup step (after WiFi). The customer types the key from their
 * purchase email; the mirror activates it with skyglass.dev. Pre-flashed kits
 * activate on their own, so this screen usually just confirms "License active"
 * for them. Also reached from Settings → License to change the key.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
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
import { colors, spacing, borderRadius, typography } from '@/lib/theme';

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
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.mutedText}>Checking license...</Text>
      </View>
    );
  }

  if (loadError && !status) {
    return (
      <View style={styles.centerContainer}>
        <Ionicons name="warning-outline" size={48} color={colors.warning} />
        <Text style={styles.centerTitle}>Can't reach your mirror</Text>
        <Text style={styles.centerText}>{loadError}</Text>
        {inSetupFlow && (
          <Text style={styles.centerText}>
            If the mirror just joined your WiFi, give it a minute to restart and make sure your
            phone is on the same network, then retry.
          </Text>
        )}
        <TouchableOpacity style={styles.secondaryButton} onPress={loadStatus}>
          <Text style={styles.secondaryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isActive = status?.state === 'active';

  // Licensing switched off, opened from Settings: nothing to enter.
  if (isDisabled) {
    return (
      <View style={styles.centerContainer}>
        <Ionicons name="key-outline" size={48} color={colors.textMuted} />
        <Text style={styles.centerTitle}>Licensing is off</Text>
        <Text style={styles.centerText}>
          This mirror doesn't require a license key.
        </Text>
        <TouchableOpacity style={styles.primaryButtonInline} onPress={continueOn}>
          <Text style={styles.primaryButtonText}>Continue</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Already active (pre-flashed kit, or revisiting from Settings).
  if (isActive && !changingKey) {
    return (
      <View style={styles.centerContainer}>
        <View style={styles.activeBadge}>
          <Ionicons name="checkmark" size={36} color={colors.background} />
        </View>
        <Text style={styles.centerTitle}>
          License active{status?.keyLast4 ? ` (…${status.keyLast4})` : ''}
        </Text>
        <Text style={styles.centerText}>
          {justActivated
            ? 'Your key is activated on this mirror. Keep the email it came in: you’ll need ' +
              'the key again if you move the license to another mirror.'
            : inSetupFlow
            ? 'This mirror already has an active license, so there is no key to enter. ' +
              'Kits come with the license pre-installed.'
            : `${
                status?.activatedAt
                  ? `Activated ${new Date(status.activatedAt).toLocaleDateString()}. `
                  : ''
              }This mirror is licensed.`}
        </Text>
        <TouchableOpacity style={styles.primaryButtonInline} onPress={continueOn}>
          <Text style={styles.primaryButtonText}>Continue</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.linkButton} onPress={() => setChangingKey(true)}>
          <Text style={styles.linkButtonText}>Use a different key</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.linkButton} onPress={openManagePage}>
          <Text style={styles.linkButtonText}>Manage license</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const stateNotice = status ? describeCurrentState(status) : null;
  const notice = error ?? stateNotice;

  return (
    <KeyboardAvoidingScreen style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.instructions}>
          <Ionicons name="key-outline" size={20} color={colors.accent} />
          <View style={styles.instructionsBody}>
            <Text style={styles.instructionsTitle}>Where's my key?</Text>
            <Text style={styles.instructionsText}>
              It's in your SkyGlass order confirmation email, in the form XXXX-XXXX-XXXX-XXXX.
              Bought a kit? The key comes pre-installed and activates on its own once the mirror
              is online, so you shouldn't need to type anything.
            </Text>
          </View>
        </View>

        {notice && (
          <View style={[styles.notice, error ? styles.noticeError : styles.noticeWarning]}>
            <Ionicons
              name={error ? 'alert-circle' : 'information-circle'}
              size={20}
              color={error ? colors.error : colors.warning}
            />
            <View style={styles.noticeBody}>
              <Text style={styles.noticeTitle}>{notice.title}</Text>
              <Text style={styles.noticeText}>{notice.message}</Text>
              {notice.showManageLink && (
                <TouchableOpacity onPress={openManagePage} accessibilityRole="link">
                  <Text style={styles.noticeLink}>
                    {manageUrl.replace(/^https?:\/\//, '')}
                  </Text>
                </TouchableOpacity>
              )}
              {!error && status?.state === 'expired' && (
                <TouchableOpacity
                  onPress={handleRefresh}
                  disabled={refreshing}
                  style={styles.noticeAction}
                >
                  {refreshing ? (
                    <ActivityIndicator size="small" color={colors.warning} />
                  ) : (
                    <Text style={styles.noticeLink}>Check again</Text>
                  )}
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        <Text style={styles.label}>LICENSE KEY</Text>
        <TextInput
          style={[styles.keyInput, normalized && styles.keyInputValid]}
          value={key}
          onChangeText={(text) => {
            setKey(formatLicenseKeyInput(text));
            if (error) setError(null);
          }}
          placeholder="XXXX-XXXX-XXXX-XXXX"
          placeholderTextColor={colors.textDisabled}
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
        />
        {keyHint && (keyComplete || /[01OI]/.test(key)) ? (
          <Text style={styles.hintError}>{keyHint}</Text>
        ) : (
          <Text style={styles.hint}>
            Dashes are added for you. Keys never contain 0, O, 1 or I.
          </Text>
        )}

        <TouchableOpacity
          onPress={openManagePage}
          style={styles.linkButton}
          accessibilityRole="link"
        >
          <Text style={styles.linkButtonText}>Lost your key or moving it from another mirror?</Text>
          <Text style={styles.linkButtonCaption}>
            Have it re-sent or release it at {manageUrl.replace(/^https?:\/\//, '')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={openStore} style={styles.linkButton} accessibilityRole="link">
          <Text style={styles.linkButtonText}>Don't have a license?</Text>
          <Text style={styles.linkButtonCaption}>
            Buy one at {STORE_URL.replace(/^https?:\/\//, '')}
          </Text>
        </TouchableOpacity>

        {isActive && changingKey && (
          <TouchableOpacity onPress={() => setChangingKey(false)} style={styles.linkButton}>
            <Text style={styles.mutedText}>Keep the current key (…{status?.keyLast4})</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.primaryButton, !normalized && styles.primaryButtonDisabled]}
          onPress={handleActivate}
          disabled={!normalized || submitting}
          accessibilityRole="button"
        >
          {submitting ? (
            <ActivityIndicator size="small" color={colors.background} />
          ) : (
            <>
              <Ionicons
                name="key"
                size={20}
                color={normalized ? colors.background : colors.textMuted}
              />
              <Text
                style={[styles.primaryButtonText, !normalized && styles.primaryButtonTextDisabled]}
              >
                Activate
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingScreen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.background,
  },
  centerTitle: {
    ...typography.h2,
    color: colors.text,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  centerText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  mutedText: {
    ...typography.bodySmall,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  activeBadge: {
    width: 72,
    height: 72,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  instructions: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.accentMuted,
    borderRadius: borderRadius.md,
    marginBottom: spacing.lg,
  },
  instructionsBody: {
    flex: 1,
    gap: spacing.xs,
  },
  instructionsTitle: {
    ...typography.bodySmall,
    color: colors.text,
    fontWeight: '600',
  },
  instructionsText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  notice: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    marginBottom: spacing.lg,
  },
  noticeError: {
    backgroundColor: 'rgba(255, 68, 68, 0.1)',
    borderColor: 'rgba(255, 68, 68, 0.3)',
  },
  noticeWarning: {
    backgroundColor: 'rgba(255, 170, 0, 0.1)',
    borderColor: 'rgba(255, 170, 0, 0.3)',
  },
  noticeBody: {
    flex: 1,
    gap: spacing.xs,
  },
  noticeTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
  noticeText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  noticeLink: {
    ...typography.bodySmall,
    color: colors.primary,
    fontWeight: '600',
    paddingVertical: spacing.xs,
  },
  noticeAction: {
    alignSelf: 'flex-start',
    minHeight: 32,
    justifyContent: 'center',
  },
  label: {
    ...typography.label,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  keyInput: {
    height: 64,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontFamily: 'monospace',
    fontSize: 22,
    letterSpacing: 2,
    textAlign: 'center',
  },
  keyInputValid: {
    borderColor: colors.borderFocus,
  },
  hint: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  hintError: {
    ...typography.caption,
    color: colors.warning,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  linkButton: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    minHeight: 44,
    justifyContent: 'center',
  },
  linkButtonText: {
    ...typography.bodySmall,
    color: colors.primary,
  },
  linkButtonCaption: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  footer: {
    padding: spacing.lg,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 56,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
  },
  primaryButtonInline: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    height: 56,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
    marginTop: spacing.sm,
  },
  primaryButtonDisabled: {
    backgroundColor: colors.surfaceHighlight,
  },
  primaryButtonText: {
    ...typography.body,
    color: colors.background,
    fontWeight: '600',
  },
  primaryButtonTextDisabled: {
    color: colors.textMuted,
  },
  secondaryButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
  },
  secondaryButtonText: {
    ...typography.body,
    color: colors.background,
    fontWeight: '600',
  },
});
