/**
 * Widget Detail/Configuration Screen
 * Configure individual widgets, handle OAuth for services that require it
 */

import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Switch,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import { api } from '@/lib/api';
import {
  ModuleInstance,
  ModuleDefinition,
  ModuleConfigField,
  CATEGORIES,
  SIZE_DIMENSIONS,
  getModuleById,
} from '@/lib/modules';
import { colors, spacing, borderRadius, typography } from '@/lib/theme';

// OAuth provider configurations
const OAUTH_PROVIDERS: Record<
  string,
  {
    name: string;
    icon: string;
    color: string;
    authEndpoint: string;
    tokenEndpoint: string;
    clientId: string;
    scopes: string[];
  }
> = {
  google: {
    name: 'Google',
    icon: 'logo-google',
    color: '#4285F4',
    authEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    clientId: 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com',
    scopes: [],
  },
  spotify: {
    name: 'Spotify',
    icon: 'musical-notes',
    color: '#1DB954',
    authEndpoint: 'https://accounts.spotify.com/authorize',
    tokenEndpoint: 'https://accounts.spotify.com/api/token',
    clientId: 'YOUR_SPOTIFY_CLIENT_ID',
    scopes: ['user-read-currently-playing', 'user-read-playback-state'],
  },
  todoist: {
    name: 'Todoist',
    icon: 'checkbox',
    color: '#E44332',
    authEndpoint: 'https://todoist.com/oauth/authorize',
    tokenEndpoint: 'https://todoist.com/oauth/access_token',
    clientId: 'YOUR_TODOIST_CLIENT_ID',
    scopes: ['data:read'],
  },
};

// Mapping of widget IDs to their OAuth provider
const WIDGET_OAUTH_MAPPING: Record<string, { provider: string; scopes: string[] }> = {
  calendar: {
    provider: 'google',
    scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  },
  'photo-frame': {
    provider: 'google',
    scopes: ['https://www.googleapis.com/auth/photoslibrary.readonly'],
  },
  'fitness-ring': {
    provider: 'google',
    scopes: ['https://www.googleapis.com/auth/fitness.activity.read'],
  },
  spotify: {
    provider: 'spotify',
    scopes: ['user-read-currently-playing', 'user-read-playback-state'],
  },
  'todo-list': {
    provider: 'todoist',
    scopes: ['data:read'],
  },
};

WebBrowser.maybeCompleteAuthSession();

export default function WidgetDetailScreen() {
  const { id, moduleId } = useLocalSearchParams<{ id: string; moduleId: string }>();
  const [widget, setWidget] = useState<ModuleInstance | null>(null);
  const [definition, setDefinition] = useState<ModuleDefinition | null>(null);
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [authStatus, setAuthStatus] = useState<'none' | 'authenticated' | 'expired'>('none');

  // Load widget data
  useEffect(() => {
    const loadWidget = async () => {
      try {
        const response = await fetch(`${api.getBaseUrl()}/api/layout/module/${id}`);
        const data = await response.json();
        setWidget(data);
        setConfig(data.config || {});

        const def = getModuleById(data.moduleId);
        setDefinition(def || null);

        // Check auth status
        if (data.config.accessToken) {
          setAuthStatus('authenticated');
        }
      } catch {
        // Use moduleId from params if direct fetch fails
        const def = getModuleById(moduleId);
        setDefinition(def || null);
        setWidget({
          instanceId: id,
          moduleId: moduleId,
          position: { x: 0, y: 0 },
          size: def?.defaultSize || 'medium',
          config: {},
        });
      } finally {
        setLoading(false);
      }
    };

    loadWidget();
  }, [id, moduleId]);

  // Handle OAuth authentication
  const handleOAuth = async () => {
    if (!widget || !definition) return;

    const oauthMapping = WIDGET_OAUTH_MAPPING[widget.moduleId];
    if (!oauthMapping) return;

    const provider = OAUTH_PROVIDERS[oauthMapping.provider];
    if (!provider) return;

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      // Create OAuth redirect URI
      const redirectUri = AuthSession.makeRedirectUri({
        scheme: 'skyglass',
        path: 'oauth-callback',
      });

      // Build the OAuth request
      const discovery = {
        authorizationEndpoint: provider.authEndpoint,
        tokenEndpoint: provider.tokenEndpoint,
      };

      const request = new AuthSession.AuthRequest({
        clientId: provider.clientId,
        scopes: oauthMapping.scopes,
        redirectUri,
        usePKCE: true,
      });

      const result = await request.promptAsync(discovery);

      if (result.type === 'success' && result.params.code) {
        // Exchange code for token (this would normally happen on the backend)
        const tokenResponse = await fetch(provider.tokenEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: provider.clientId,
            code: result.params.code,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
            code_verifier: request.codeVerifier || '',
          }).toString(),
        });

        const tokenData = await tokenResponse.json();

        if (tokenData.access_token) {
          // Store the tokens in the widget config
          const newConfig = {
            ...config,
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
            tokenExpiry: Date.now() + tokenData.expires_in * 1000,
          };

          setConfig(newConfig);
          setAuthStatus('authenticated');

          // Save to mirror
          await saveConfig(newConfig);

          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          Alert.alert('Success', `Connected to ${provider.name}!`);
        }
      } else if (result.type === 'error') {
        Alert.alert('Error', 'Authentication failed. Please try again.');
      }
    } catch (error) {
      console.error('OAuth error:', error);
      Alert.alert('Error', 'Failed to authenticate. Please try again.');
    }
  };

  // Disconnect OAuth
  const handleDisconnect = () => {
    Alert.alert(
      'Disconnect Account',
      'This will remove the connected account. You can reconnect anytime.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            const newConfig = { ...config };
            delete newConfig.accessToken;
            delete newConfig.refreshToken;
            delete newConfig.tokenExpiry;
            setConfig(newConfig);
            setAuthStatus('none');
            await saveConfig(newConfig);
          },
        },
      ]
    );
  };

  // Save configuration to mirror
  const saveConfig = async (configToSave?: Record<string, unknown>) => {
    if (!widget) return;

    setSaving(true);
    try {
      await fetch(`${api.getBaseUrl()}/api/layout/module/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: configToSave || config,
        }),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert('Error', 'Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  // Update a config field
  const updateField = (key: string, value: unknown) => {
    setConfig({ ...config, [key]: value });
  };

  // Render a config field
  const renderField = (field: ModuleConfigField) => {
    const value = config[field.key];

    switch (field.type) {
      case 'boolean':
        return (
          <View key={field.key} style={styles.field}>
            <View style={styles.fieldHeader}>
              <Text style={styles.fieldLabel}>{field.label}</Text>
              <Switch
                value={Boolean(value ?? field.default)}
                onValueChange={(v) => updateField(field.key, v)}
                trackColor={{ false: colors.surfaceHighlight, true: colors.primaryMuted }}
                thumbColor={value ? colors.primary : colors.textMuted}
              />
            </View>
            {field.description && (
              <Text style={styles.fieldDescription}>{field.description}</Text>
            )}
          </View>
        );

      case 'select':
        return (
          <View key={field.key} style={styles.field}>
            <Text style={styles.fieldLabel}>{field.label}</Text>
            {field.description && (
              <Text style={styles.fieldDescription}>{field.description}</Text>
            )}
            <View style={styles.selectContainer}>
              {field.options?.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.selectOption,
                    (value ?? field.default) === option.value && styles.selectOptionActive,
                  ]}
                  onPress={() => updateField(field.key, option.value)}
                >
                  <Text
                    style={[
                      styles.selectOptionText,
                      (value ?? field.default) === option.value && styles.selectOptionTextActive,
                    ]}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        );

      case 'number':
        return (
          <View key={field.key} style={styles.field}>
            <Text style={styles.fieldLabel}>{field.label}</Text>
            {field.description && (
              <Text style={styles.fieldDescription}>{field.description}</Text>
            )}
            <TextInput
              style={styles.textInput}
              value={String(value ?? field.default ?? '')}
              onChangeText={(text) => updateField(field.key, Number(text) || 0)}
              keyboardType="numeric"
              placeholderTextColor={colors.textMuted}
            />
          </View>
        );

      case 'airport':
        return (
          <View key={field.key} style={styles.field}>
            <Text style={styles.fieldLabel}>{field.label}</Text>
            {field.description && (
              <Text style={styles.fieldDescription}>{field.description}</Text>
            )}
            <TouchableOpacity
              style={styles.specialInput}
              onPress={() => {
                // Navigate to airport picker
                router.push({
                  pathname: '/setup/airport',
                  params: { returnTo: `/widget/${id}`, configKey: field.key },
                });
              }}
            >
              <Ionicons name="airplane" size={20} color={colors.primary} />
              <Text style={styles.specialInputText}>
                {String(value || field.placeholder || 'Select airport...')}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        );

      case 'location':
        return (
          <View key={field.key} style={styles.field}>
            <Text style={styles.fieldLabel}>{field.label}</Text>
            {field.description && (
              <Text style={styles.fieldDescription}>{field.description}</Text>
            )}
            <TouchableOpacity
              style={styles.specialInput}
              onPress={() => {
                // Navigate to location picker
                router.push({
                  pathname: '/setup/location',
                  params: { returnTo: `/widget/${id}`, configKey: field.key },
                });
              }}
            >
              <Ionicons name="location" size={20} color={colors.accent} />
              <Text style={styles.specialInputText}>
                {value ? 'Location set' : 'Set location...'}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        );

      default:
        return (
          <View key={field.key} style={styles.field}>
            <Text style={styles.fieldLabel}>{field.label}</Text>
            {field.description && (
              <Text style={styles.fieldDescription}>{field.description}</Text>
            )}
            <TextInput
              style={styles.textInput}
              value={String(value ?? field.default ?? '')}
              onChangeText={(text) => updateField(field.key, text)}
              placeholder={field.placeholder}
              placeholderTextColor={colors.textMuted}
            />
          </View>
        );
    }
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!definition || !widget) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>Widget not found</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.errorLink}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const categoryInfo = CATEGORIES[definition.category];
  const oauthMapping = WIDGET_OAUTH_MAPPING[widget.moduleId];
  const oauthProvider = oauthMapping ? OAUTH_PROVIDERS[oauthMapping.provider] : null;
  const needsOAuth = Boolean(oauthMapping);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Configure Widget</Text>
        <TouchableOpacity
          style={styles.headerButton}
          onPress={() => saveConfig()}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Text style={styles.saveButton}>Save</Text>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        {/* Widget info card */}
        <View style={styles.infoCard}>
          <View style={[styles.infoIcon, { backgroundColor: categoryInfo.color + '20' }]}>
            <Ionicons name={definition.icon as any} size={32} color={categoryInfo.color} />
          </View>
          <View style={styles.infoContent}>
            <Text style={styles.infoName}>{definition.name}</Text>
            <Text style={styles.infoDescription}>{definition.description}</Text>
            <View style={styles.infoMeta}>
              <View style={[styles.categoryBadge, { backgroundColor: categoryInfo.color + '20' }]}>
                <Ionicons name={categoryInfo.icon as any} size={12} color={categoryInfo.color} />
                <Text style={[styles.categoryBadgeText, { color: categoryInfo.color }]}>
                  {categoryInfo.label}
                </Text>
              </View>
              {definition.premium && (
                <View style={styles.premiumBadge}>
                  <Ionicons name="star" size={10} color={colors.warning} />
                  <Text style={styles.premiumBadgeText}>PRO</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* OAuth section */}
        {needsOAuth && oauthProvider && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>CONNECTED ACCOUNT</Text>
            <View style={styles.oauthCard}>
              {authStatus === 'authenticated' ? (
                <>
                  <View style={[styles.oauthIcon, { backgroundColor: oauthProvider.color + '20' }]}>
                    <Ionicons
                      name={oauthProvider.icon as any}
                      size={24}
                      color={oauthProvider.color}
                    />
                  </View>
                  <View style={styles.oauthContent}>
                    <Text style={styles.oauthName}>Connected to {oauthProvider.name}</Text>
                    <Text style={styles.oauthStatus}>
                      <Ionicons name="checkmark-circle" size={12} color={colors.primary} />{' '}
                      Authenticated
                    </Text>
                  </View>
                  <TouchableOpacity style={styles.disconnectButton} onPress={handleDisconnect}>
                    <Text style={styles.disconnectButtonText}>Disconnect</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <View style={[styles.oauthIcon, { backgroundColor: colors.surfaceHighlight }]}>
                    <Ionicons name={oauthProvider.icon as any} size={24} color={colors.textMuted} />
                  </View>
                  <View style={styles.oauthContent}>
                    <Text style={styles.oauthName}>Sign in with {oauthProvider.name}</Text>
                    <Text style={styles.oauthDescription}>
                      Required to access your {definition.name.toLowerCase()}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.connectButton, { backgroundColor: oauthProvider.color }]}
                    onPress={handleOAuth}
                  >
                    <Text style={styles.connectButtonText}>Connect</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        )}

        {/* Size selector */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>SIZE</Text>
          <View style={styles.sizeGrid}>
            {definition.sizes.map((size) => {
              const dims = SIZE_DIMENSIONS[size];
              return (
                <TouchableOpacity
                  key={size}
                  style={[styles.sizeOption, widget.size === size && styles.sizeOptionActive]}
                  onPress={() => {
                    setWidget({ ...widget, size });
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }}
                >
                  <View
                    style={[
                      styles.sizePreview,
                      {
                        width: dims.cols * 6,
                        height: dims.rows * 6,
                      },
                      widget.size === size && styles.sizePreviewActive,
                    ]}
                  />
                  <Text
                    style={[
                      styles.sizeLabel,
                      widget.size === size && styles.sizeLabelActive,
                    ]}
                  >
                    {size}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Configuration fields */}
        {definition.configFields.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>SETTINGS</Text>
            {definition.configFields.map(renderField)}
          </View>
        )}

        {/* Delete widget */}
        <TouchableOpacity
          style={styles.deleteButton}
          onPress={() => {
            Alert.alert(
              'Remove Widget',
              `Remove "${definition.name}" from your mirror?`,
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Remove',
                  style: 'destructive',
                  onPress: async () => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                    try {
                      await fetch(`${api.getBaseUrl()}/api/layout/module/${id}`, {
                        method: 'DELETE',
                      });
                      router.back();
                    } catch {
                      Alert.alert('Error', 'Failed to remove widget');
                    }
                  },
                },
              ]
            );
          }}
        >
          <Ionicons name="trash-outline" size={20} color={colors.error} />
          <Text style={styles.deleteButtonText}>Remove Widget</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: 60,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerButton: {
    padding: spacing.sm,
  },
  headerTitle: {
    ...typography.h3,
    color: colors.text,
  },
  saveButton: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
  },
  errorText: {
    ...typography.body,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  errorLink: {
    ...typography.body,
    color: colors.primary,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacing.lg,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  infoIcon: {
    width: 64,
    height: 64,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  infoContent: {
    flex: 1,
  },
  infoName: {
    ...typography.h3,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  infoDescription: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  infoMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.sm,
  },
  categoryBadgeText: {
    ...typography.caption,
    fontWeight: '600',
  },
  premiumBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    backgroundColor: 'rgba(255, 170, 0, 0.2)',
    borderRadius: borderRadius.sm,
  },
  premiumBadgeText: {
    ...typography.caption,
    color: colors.warning,
    fontWeight: '700',
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    ...typography.label,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  oauthCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  oauthIcon: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  oauthContent: {
    flex: 1,
  },
  oauthName: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
    marginBottom: 2,
  },
  oauthStatus: {
    ...typography.caption,
    color: colors.primary,
  },
  oauthDescription: {
    ...typography.caption,
    color: colors.textMuted,
  },
  connectButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
  },
  connectButtonText: {
    ...typography.bodySmall,
    color: '#fff',
    fontWeight: '600',
  },
  disconnectButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceHighlight,
    borderRadius: borderRadius.md,
  },
  disconnectButtonText: {
    ...typography.bodySmall,
    color: colors.textMuted,
  },
  sizeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  sizeOption: {
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 80,
  },
  sizeOptionActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryMuted,
  },
  sizePreview: {
    backgroundColor: colors.textMuted,
    borderRadius: 2,
    marginBottom: spacing.xs,
    opacity: 0.3,
  },
  sizePreviewActive: {
    backgroundColor: colors.primary,
    opacity: 1,
  },
  sizeLabel: {
    ...typography.caption,
    color: colors.textMuted,
    textTransform: 'capitalize',
  },
  sizeLabelActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  field: {
    marginBottom: spacing.lg,
  },
  fieldHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  fieldLabel: {
    ...typography.body,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  fieldDescription: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  textInput: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    color: colors.text,
    ...typography.body,
  },
  selectContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  selectOption: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  selectOptionActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryMuted,
  },
  selectOptionText: {
    ...typography.bodySmall,
    color: colors.textMuted,
  },
  selectOptionTextActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  specialInput: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  specialInputText: {
    ...typography.body,
    color: colors.text,
    flex: 1,
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: 'rgba(255, 68, 68, 0.1)',
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255, 68, 68, 0.3)',
    marginTop: spacing.xl,
  },
  deleteButtonText: {
    ...typography.body,
    color: colors.error,
    fontWeight: '500',
  },
});
