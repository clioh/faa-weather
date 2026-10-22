/**
 * Layout editor
 *
 * Arrange the widgets on a mirror. The canvas is drawn at the mirror's real
 * aspect ratio and grid, tiles are dragged and resized directly, and every
 * change streams to the mirror as a live preview. Nothing is stored until
 * Save. Layouts are per user when a profile exists, with the mirror's global
 * layout as the fallback.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View } from 'react-native';
import { Button, Spinner, Text } from '@/components/ui';
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from 'expo-router';
// expo-router bundles its own copy of React Navigation; hooks must come from
// it or they cannot find the navigator.
import { usePreventRemove, type NavigationAction } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { MirrorNotFound, ScreenHeader } from '@/components';
import {
  MODULES,
  defaultConfigFor,
  generateInstanceId,
  getModuleById,
  missingRequiredFields,
  type MirrorLayout,
  type ModuleInstance,
  type ModuleSize,
} from '@/lib/modules';
import { api } from '@/lib/api';
import { useUser } from '@/context/UserContext';
import { useDisplayHold } from '@/hooks/useDisplayHold';
import { goBack } from '@/lib/navigation';
import { colors, spacing, typography } from '@/lib/theme';
import { getTemplateById } from '@/lib/templates';
import { Canvas, type MirrorOrientation } from '@/components/editor/Canvas';
import { ConfigSheet } from '@/components/editor/ConfigSheet';
import { DiscardSheet } from '@/components/editor/DiscardSheet';
import { LibrarySheet } from '@/components/editor/LibrarySheet';
import { SelectionBar, SELECTION_BAR_HEIGHT } from '@/components/editor/SelectionBar';
import { Toolbar } from '@/components/editor/Toolbar';
import { EditorToast, useEditorToast } from '@/components/editor/Toast';
import type { SizeOption } from '@/components/editor/SizeChips';
import {
  canPlace,
  commitFrom,
  createHistory,
  createInstance,
  duplicateInstance,
  findPlacement,
  layoutsEqual,
  moveInstance,
  normalizeLayout,
  placementForSize,
  pushHistory,
  rectOf,
  redoHistory,
  replacePresent,
  resizeInstance,
  tidyLayout,
  toRects,
  undoHistory,
  type LayoutHistory,
} from '@/components/editor/layoutUtils';

function instanceFor(moduleId: string, x: number, y: number, size: ModuleSize): ModuleInstance {
  const def = getModuleById(moduleId);
  return {
    instanceId: generateInstanceId(),
    moduleId,
    position: { x, y },
    size,
    config: def ? defaultConfigFor(def) : {},
  };
}

/** Shown when the mirror has no layout yet. */
const defaultTiles = () => [instanceFor('digital-clock', 0, 0, 'medium'), instanceFor('metar', 4, 0, 'medium')];

function sameGeometry(a: ModuleInstance[], b: ModuleInstance[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (m, i) =>
        m.instanceId === b[i].instanceId &&
        m.size === b[i].size &&
        m.position.x === b[i].position.x &&
        m.position.y === b[i].position.y
    )
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** HTTP status on errors thrown by api.request(); undefined for network failures. */
function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : undefined;
}

type LiveState = 'pending' | 'live' | 'unreachable';

export default function EditorScreen() {
  const { user, currentMirror } = useUser();
  const params = useLocalSearchParams<{ templateId?: string; applyKey?: string }>();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  // Keep the mirror awake so edits can be checked on the real display.
  useDisplayHold(Boolean(currentMirror));

  const [history, setHistory] = useState<LayoutHistory>(() => createHistory([]));
  const modules = history.present;
  // Gesture callbacks are memoised into the tiles; they read the latest
  // layout from here instead of closing over a stale render.
  const modulesRef = useRef(modules);
  modulesRef.current = modules;

  const [baseline, setBaseline] = useState('[]');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  // The mirror's global layout as loaded, so a fallback save keeps its id/name.
  const mirrorLayout = useRef<MirrorLayout | null>(null);
  const [live, setLive] = useState<LiveState>('pending');
  const [orientation, setOrientation] = useState<MirrorOrientation>('landscape');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pulse, setPulse] = useState<{ id: string; key: number } | null>(null);
  const [revision, setRevision] = useState(0);
  const [showLibrary, setShowLibrary] = useState(false);
  const [configId, setConfigId] = useState<string | null>(null);
  const configBase = useRef<ModuleInstance[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [appliedTemplateId, setAppliedTemplateId] = useState<string | null>(null);
  const [discardVisible, setDiscardVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const pendingLeave = useRef<NavigationAction | null>(null);
  const { toast, show: showToast } = useEditorToast();

  const dirty = useMemo(() => JSON.stringify(modules) !== baseline, [modules, baseline]);

  // ------------------------------------------------------------ loading

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      setLoadError(null);
      let loaded: ModuleInstance[] | null = null;
      let fromServer = true;
      try {
        if (user) {
          try {
            // An existing user layout is authoritative even when empty.
            const userLayout = await api.getUserLayout(user.id);
            loaded = userLayout?.modules ?? [];
          } catch (e) {
            // Only "no layout for this user" falls back; anything else
            // (offline, 500) must not let the user edit and save over the
            // real layout with something else.
            if (statusOf(e) !== 404) throw e;
          }
        }
        if (loaded === null) {
          try {
            const layout = await api.getLayout();
            mirrorLayout.current = layout ?? null;
            loaded = layout?.modules ?? [];
          } catch (e) {
            if (statusOf(e) !== 404) throw e;
            // Neither a user nor a mirror layout exists: offer a starter.
            loaded = defaultTiles();
            fromServer = false;
          }
        }
      } catch (e) {
        if (cancelled) return;
        setLoadError(
          statusOf(e) === undefined
            ? 'Couldn’t reach the mirror. Make sure your phone is on the same network.'
            : 'The mirror couldn’t load its layout. Try again in a moment.'
        );
        setIsLoading(false);
        return;
      }
      if (cancelled) return;

      const { modules: fitted, dropped } = normalizeLayout(loaded, getModuleById);
      setHistory(createHistory(fitted));
      // A layout we had to repair counts as unsaved so the fix can be saved.
      const repaired = fromServer && (dropped.length > 0 || !sameGeometry(fitted, loaded));
      setBaseline(JSON.stringify(repaired ? loaded : fitted));
      setSelectedId(null);
      setIsLoading(false);
      if (dropped.length > 0) {
        showToast(`${plural(dropped.length, 'widget')} didn’t fit and ${dropped.length === 1 ? 'was' : 'were'} left out`, 'info');
      }
    };
    load();
    return () => {
      cancelled = true;
    };
    // Reload only when the person changes (or on Retry), not on every
    // profile field update.
  }, [user?.id, loadAttempt]);

  useEffect(() => {
    if (!currentMirror) return;
    let cancelled = false;
    api
      .getConfig()
      .then((config) => {
        const display = config?.display as { orientation?: string } | undefined;
        if (!cancelled) setOrientation(display?.orientation === 'portrait' ? 'portrait' : 'landscape');
      })
      .catch(() => {
        // Unreachable mirror: keep the landscape default.
      });
    return () => {
      cancelled = true;
    };
  }, [currentMirror]);

  // Mirror the working layout onto the display as it changes. This is a
  // preview only: nothing is stored until Save.
  const editable = !isLoading && !loadError;

  const sendPreview = useCallback((next: ModuleInstance[]) => {
    api
      .previewLayout(next)
      .then(() => setLive('live'))
      .catch(() => setLive('unreachable'));
  }, []);

  useEffect(() => {
    if (!editable || !currentMirror) return;
    const timer = setTimeout(() => sendPreview(modules), 300);
    return () => clearTimeout(timer);
  }, [modules, editable, currentMirror, sendPreview]);

  // Leaving the screen (e.g. to /templates) releases the display hold, which
  // clears the preview on the mirror. Put it back when we regain focus.
  useFocusEffect(
    useCallback(() => {
      if (!editable || !currentMirror) return;
      sendPreview(modulesRef.current);
      return () => setLive('pending');
    }, [editable, currentMirror, sendPreview])
  );

  // templates.tsx navigates back to this same editor instance with a new
  // templateId, so track the last applied id rather than a one-shot flag.
  // Waiting for the load keeps it from being overwritten when the editor is
  // opened straight from onboarding with a template.
  // `applyKey` lets the same template be applied again after an undo.
  const templateRequest = params.templateId ? `${params.templateId}:${params.applyKey ?? ''}` : null;
  useEffect(() => {
    if (!editable || !params.templateId || templateRequest === appliedTemplateId) return;
    setAppliedTemplateId(templateRequest);
    const template = getTemplateById(params.templateId);
    if (!template) return;
    const templateModules: ModuleInstance[] = template.modules.map((mod) => ({
      ...mod,
      instanceId: generateInstanceId(),
      config: { ...mod.config },
    }));
    const { modules: fitted } = normalizeLayout(templateModules, getModuleById);
    setHistory((h) => pushHistory(h, fitted));
    setSelectedId(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    showToast(`Applied ${template.name}. Save to keep it.`, 'success');
  }, [params.templateId, templateRequest, appliedTemplateId, editable, showToast]);

  // ------------------------------------------------------------ edits

  /**
   * Apply an edit to the latest committed layout. The edit runs inside the
   * state updater so two quick commits (e.g. a drop landing while another
   * re-render is pending) each see the other's result, never a stale copy.
   * `onReject` runs when the edit is refused because it would break the
   * no-overlap/in-bounds invariant.
   */
  const commit = useCallback(
    (edit: (present: ModuleInstance[]) => ModuleInstance[] | null, onReject?: () => void) => {
      setHistory((h) => {
        const next = edit(h.present);
        if (next) return pushHistory(h, next);
        // Updaters run during render; defer the follow-up state change.
        if (onReject) queueMicrotask(onReject);
        return h;
      });
    },
    []
  );

  const bumpRevision = useCallback(() => setRevision((r) => r + 1), []);

  const handleSelect = useCallback((id: string | null) => setSelectedId(id), []);

  const handleMove = useCallback(
    (id: string, x: number, y: number) => commit((m) => moveInstance(m, id, x, y), bumpRevision),
    [commit, bumpRevision]
  );

  const handleResize = useCallback(
    (id: string, size: ModuleSize) => commit((m) => resizeInstance(m, id, size), bumpRevision),
    [commit, bumpRevision]
  );

  const handleNudge = useCallback(
    (id: string, dx: number, dy: number) => {
      const m = modulesRef.current.find((t) => t.instanceId === id);
      if (!m) return;
      const x = m.position.x + dx;
      const y = m.position.y + dy;
      if (moveInstance(modulesRef.current, id, x, y)) {
        commit((present) => moveInstance(present, id, x, y));
        AccessibilityInfo.announceForAccessibility(`Column ${x + 1}, row ${y + 1}`);
      } else {
        AccessibilityInfo.announceForAccessibility('No room there');
      }
    },
    [commit]
  );

  /** Append a tile placed against `snapshot`, re-checking it against the latest layout. */
  const appendTile = (inst: ModuleInstance) =>
    commit(
      (present) => (canPlace(toRects(present), rectOf(inst), null) ? [...present, inst] : null),
      // The snapshot the tile was placed against was stale and the spot is
      // taken after all: undo the optimistic selection and say so.
      () => {
        setSelectedId((s) => (s === inst.instanceId ? null : s));
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        showToast('No room — remove or shrink a widget', 'error');
      }
    );

  const pulseTile = (id: string) => {
    // Wait for the sheet's dismiss animation so the pulse is actually seen.
    setTimeout(() => setPulse({ id, key: Date.now() }), 380);
  };

  const addWidget = (def: (typeof MODULES)[number]) => {
    const inst = createInstance(modulesRef.current, def);
    if (!inst) return false;
    appendTile(inst);
    setShowLibrary(false);
    setSelectedId(inst.instanceId);
    pulseTile(inst.instanceId);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    return true;
  };

  const duplicateSelected = () => {
    const source = modulesRef.current.find((m) => m.instanceId === selectedId);
    if (!source) return;
    const copy = duplicateInstance(modulesRef.current, source, getModuleById(source.moduleId));
    if (!copy) {
      showToast('No room — remove or shrink a widget', 'error');
      return;
    }
    appendTile(copy);
    setSelectedId(copy.instanceId);
    setPulse({ id: copy.instanceId, key: Date.now() });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };

  const removeTile = (id: string) => {
    commit((present) => present.filter((m) => m.instanceId !== id));
    setSelectedId((s) => (s === id ? null : s));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  };

  const setSelectedSize = (size: ModuleSize) => {
    if (!selectedId) return;
    const id = selectedId;
    commit((present) => resizeInstance(present, id, size));
    Haptics.selectionAsync().catch(() => {});
  };

  const tidied = useMemo(() => tidyLayout(modules), [modules]);
  const canTidy = !layoutsEqual(tidied, modules);
  const tidy = () => {
    commit(tidyLayout);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };

  const undo = () => {
    setHistory(undoHistory);
    Haptics.selectionAsync().catch(() => {});
  };
  const redo = () => {
    setHistory(redoHistory);
    Haptics.selectionAsync().catch(() => {});
  };

  const openTemplates = () => {
    router.push({
      pathname: '/templates',
      params: { hasModules: modules.length > 0 ? 'true' : 'false' },
    });
  };

  // ------------------------------------------------------------ configure sheet

  const openConfig = (id: string) => {
    configBase.current = modulesRef.current;
    setConfigId(id);
  };

  const closeConfig = () => {
    const base = configBase.current;
    configBase.current = null;
    setConfigId(null);
    // The whole sheet session becomes one undo step.
    if (base) setHistory((h) => commitFrom(h, base));
  };

  const changeConfig = (config: Record<string, unknown>) => {
    if (!configId) return;
    setHistory((h) =>
      replacePresent(
        h,
        h.present.map((m) => (m.instanceId === configId ? { ...m, config } : m))
      )
    );
  };

  const changeConfigSize = (size: ModuleSize) => {
    if (!configId) return;
    const id = configId;
    setHistory((h) => replacePresent(h, resizeInstance(h.present, id, size) ?? h.present));
  };

  const removeFromConfig = () => {
    const id = configId;
    closeConfig();
    if (id) removeTile(id);
  };

  // ------------------------------------------------------------ save / leave

  const save = async () => {
    if (saving) return;
    setSaving(true);
    const snapshot = modulesRef.current;
    const asGlobal = (): MirrorLayout => {
      const now = new Date().toISOString();
      const base = mirrorLayout.current;
      return {
        id: base?.id ?? 'custom',
        name: base?.name ?? 'Custom Layout',
        createdAt: base?.createdAt ?? now,
        modules: snapshot,
        updatedAt: now,
      };
    };
    try {
      if (user) {
        try {
          await api.updateUserLayout(user.id, snapshot);
        } catch (e) {
          // Only mirrors without per-user layouts (404/405) fall back to the
          // global layout; any other failure must surface, not silently
          // overwrite what everyone else sees.
          const status = statusOf(e);
          if (status !== 404 && status !== 405) throw e;
          await api.updateLayout(asGlobal());
        }
      } else {
        await api.updateLayout(asGlobal());
      }
      setBaseline(JSON.stringify(snapshot));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      showToast('Saved to mirror', 'success');
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      showToast('Couldn’t save. Check that your phone can reach the mirror.', 'error');
    } finally {
      setSaving(false);
    }
  };

  // Covers the Close button, the iOS swipe-back and Android back alike.
  usePreventRemove(dirty && !leaving, ({ data }) => {
    pendingLeave.current = data.action;
    setDiscardVisible(true);
  });

  // Set by Discard; acted on only once the sheet has finished dismissing.
  const discardChosen = useRef(false);
  const onDiscardDismissed = useCallback(() => {
    if (!discardChosen.current) return;
    discardChosen.current = false;
    setLeaving(true);
  }, []);

  useEffect(() => {
    if (!leaving) return;
    const action = pendingLeave.current;
    pendingLeave.current = null;
    if (action) navigation.dispatch(action);
    else goBack('/dashboard');
  }, [leaving, navigation]);

  const close = () => {
    if (dirty) setDiscardVisible(true);
    else goBack('/dashboard');
  };

  // ------------------------------------------------------------ derived

  const selected = modules.find((m) => m.instanceId === selectedId) ?? null;
  const selectedDef = selected ? getModuleById(selected.moduleId) : undefined;
  const configInstance = modules.find((m) => m.instanceId === configId) ?? null;
  const configDef = configInstance ? getModuleById(configInstance.moduleId) : undefined;

  const sizeOptionsFor = (inst: ModuleInstance | null): SizeOption[] => {
    const def = inst ? getModuleById(inst.moduleId) : undefined;
    if (!inst || !def) return [];
    return def.sizes.map((size) => ({
      size,
      fits: size === inst.size || placementForSize(modules, inst, size) !== null,
    }));
  };

  const noRoomIds = useMemo(() => {
    if (!showLibrary) return new Set<string>();
    return new Set(MODULES.filter((def) => !findPlacement(modules, def)).map((def) => def.id));
  }, [showLibrary, modules]);

  const subtitle = [user ? `${user.name}’s layout` : 'Mirror layout', currentMirror?.mirrorName]
    .filter(Boolean)
    .join(' · ');

  const toolbarHeight = spacing.sm + 48 + Math.max(insets.bottom, spacing.sm);

  const header = (
    <ScreenHeader
      title="Layout"
      subtitle={subtitle}
      leftIcon="close"
      onLeftPress={close}
      right={
        <Pressable
          onPress={save}
          disabled={saving || !editable}
          hitSlop={{ top: 4, bottom: 4 }}
          style={({ pressed }) => [
            styles.saveButton,
            !dirty && styles.saveButtonClean,
            !editable && styles.saveButtonDisabled,
            pressed && styles.saveButtonPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Save layout to mirror"
          accessibilityState={{ busy: saving, disabled: saving || !editable }}
        >
          {saving ? (
            <Spinner onAccent={dirty} color={dirty ? undefined : colors.text} />
          ) : (
            <Text style={[styles.saveText, !dirty && styles.saveTextClean]}>Save</Text>
          )}
        </Pressable>
      }
    />
  );

  if (isLoading) {
    return (
      <View style={styles.container}>
        {header}
        <View style={styles.loading}>
          <Spinner size="large" />
          <Text style={styles.loadingText}>Loading layout…</Text>
        </View>
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.container}>
        {header}
        <View style={styles.loading}>
          <Ionicons name="cloud-offline-outline" size={36} color={colors.textMuted} />
          <Text style={styles.errorTitle}>Layout not loaded</Text>
          <Text style={styles.errorBody}>{loadError}</Text>
          <Button
            label="Retry"
            size="small"
            icon="refresh"
            onPress={() => setLoadAttempt((n) => n + 1)}
            accessibilityLabel="Retry loading layout"
            style={styles.retryButton}
          />
        </View>
      </View>
    );
  }

  const emptyState =
    modules.length === 0 ? (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>Your mirror is empty</Text>
        <View style={styles.emptyButtons}>
          <Button label="Add widget" size="small" onPress={() => setShowLibrary(true)} style={styles.emptyButton} />
          <Button
            label="Start from a template"
            size="small"
            variant="secondary"
            onPress={openTemplates}
            style={styles.emptyButton}
          />
        </View>
      </View>
    ) : null;

  return (
    <View style={styles.container}>
      {header}

      <View style={styles.statusRow}>
        {currentMirror && live === 'live' ? (
          <View style={styles.livePill} accessibilityLabel="Changes show live on the mirror">
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>Live on mirror</Text>
          </View>
        ) : currentMirror && live === 'unreachable' ? (
          <View style={styles.livePill}>
            <Ionicons name="alert-circle-outline" size={12} color={colors.warning} />
            <Text style={styles.warnText}>Mirror not responding</Text>
          </View>
        ) : currentMirror ? (
          <View style={styles.livePill}>
            <Spinner color={colors.textMuted} style={styles.pillSpinner} />
            <Text style={styles.offlineText}>Connecting to mirror…</Text>
          </View>
        ) : (
          <View style={styles.livePill}>
            <Ionicons name="cloud-offline-outline" size={12} color={colors.textMuted} />
            <Text style={styles.offlineText}>No mirror connected</Text>
          </View>
        )}
        <Text style={[styles.statusText, dirty && styles.statusDirty]}>
          {dirty ? 'Unsaved changes' : `${plural(modules.length, 'widget')} · Saved`}
        </Text>
      </View>

      {currentMirror && live === 'unreachable' && (
        <View style={styles.notFound}>
          <MirrorNotFound onFound={() => sendPreview(modulesRef.current)} />
        </View>
      )}

      <Canvas
        modules={modules}
        orientation={orientation}
        selectedId={selected ? selected.instanceId : null}
        pulse={pulse}
        revision={revision}
        onSelect={handleSelect}
        onMove={handleMove}
        onResize={handleResize}
        onNudge={handleNudge}
        overlay={emptyState}
      />

      <SelectionBar
        instance={selected}
        definition={selectedDef}
        sizeOptions={sizeOptionsFor(selected)}
        needsSetup={selected && selectedDef ? missingRequiredFields(selectedDef, selected.config ?? {}).length > 0 : false}
        empty={modules.length === 0}
        onSize={setSelectedSize}
        onConfigure={() => selected && openConfig(selected.instanceId)}
        onDuplicate={duplicateSelected}
        onRemove={() => selected && removeTile(selected.instanceId)}
      />

      <Toolbar
        onAdd={() => setShowLibrary(true)}
        onTemplates={openTemplates}
        onTidy={tidy}
        onUndo={undo}
        onRedo={redo}
        canTidy={canTidy}
        canUndo={history.past.length > 0}
        canRedo={history.future.length > 0}
      />

      <EditorToast toast={toast} bottom={toolbarHeight + SELECTION_BAR_HEIGHT + spacing.sm} />

      <LibrarySheet
        visible={showLibrary}
        onClose={() => setShowLibrary(false)}
        onAdd={addWidget}
        noRoomIds={noRoomIds}
      />

      <ConfigSheet
        visible={configInstance !== null}
        instance={configInstance}
        definition={configDef}
        sizeOptions={sizeOptionsFor(configInstance)}
        onChangeConfig={changeConfig}
        onChangeSize={changeConfigSize}
        onRemove={removeFromConfig}
        onDone={closeConfig}
      />

      <DiscardSheet
        visible={discardVisible}
        onKeepEditing={() => {
          pendingLeave.current = null;
          setDiscardVisible(false);
        }}
        onDiscard={() => {
          discardChosen.current = true;
          setDiscardVisible(false);
        }}
        onDismissed={onDiscardDismissed}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  loadingText: {
    ...typography.bodySmall,
    color: colors.textMuted,
  },
  // Pill in the header's right slot: primary when there is something to save.
  saveButton: {
    minWidth: 64,
    height: 36,
    paddingHorizontal: spacing.md,
    borderRadius: 18,
    backgroundColor: colors.primary,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.xs,
  },
  saveButtonClean: {
    backgroundColor: 'transparent',
    borderColor: colors.borderStrong,
  },
  saveButtonDisabled: {
    opacity: 0.4,
  },
  saveButtonPressed: {
    opacity: 0.7,
  },
  saveText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.onPrimary,
  },
  saveTextClean: {
    color: colors.text,
    fontWeight: '500',
  },
  notFound: {
    paddingHorizontal: spacing.lg,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: 10,
    paddingBottom: 12,
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  liveText: {
    fontSize: 12,
    color: colors.chipText,
  },
  offlineText: {
    fontSize: 12,
    color: colors.textMuted,
  },
  warnText: {
    fontSize: 12,
    color: colors.warning,
  },
  pillSpinner: {
    transform: [{ scale: 0.6 }],
    width: 12,
    height: 12,
  },
  errorTitle: {
    ...typography.h3,
    color: colors.text,
  },
  errorBody: {
    ...typography.bodySmall,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.sm,
  },
  statusText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  statusDirty: {
    color: colors.warning,
  },
  empty: {
    alignItems: 'center',
    gap: 10,
    padding: spacing.md,
  },
  emptyTitle: {
    fontSize: 15,
    color: colors.text,
  },
  emptyButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  emptyButton: {
    height: 36,
    borderRadius: 18,
  },
  retryButton: {
    alignSelf: 'center',
  },
});
