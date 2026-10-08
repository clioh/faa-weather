/**
 * Layout Editor Screen
 * Visual drag-and-drop interface for customizing mirror layout
 * Supports per-user layouts for multi-user mirrors
 */

import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  Alert,
  Modal,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { AirportPicker, LocationPicker, ColorPicker, type LocationData } from '@/components';
import {
  ModuleInstance,
  ModuleDefinition,
  MirrorLayout,
  MODULES,
  CATEGORIES,
  SIZE_DIMENSIONS,
  getModuleById,
  generateInstanceId,
  ModuleCategory,
} from '@/lib/modules';
import { api } from '@/lib/api';
import { useUser } from '@/context/UserContext';
import { colors, spacing, borderRadius, typography } from '@/lib/theme';
import { getTemplateById, isAviationModule } from '@/lib/templates';

const SCREEN_WIDTH = Dimensions.get('window').width;
const GRID_COLS = 12;
const GRID_ROWS = 8;
const CELL_SIZE = (SCREEN_WIDTH - spacing.lg * 2) / GRID_COLS;
const MIRROR_ASPECT = 16 / 9;

export default function EditorScreen() {
  const { user, currentMirror } = useUser();
  const params = useLocalSearchParams<{ templateId?: string }>();

  const [modules, setModules] = useState<ModuleInstance[]>([]);
  const [, setLayoutName] = useState<string>('My Layout');
  const [isLoading, setIsLoading] = useState(true);
  const [templateApplied, setTemplateApplied] = useState(false);

  const [showLibrary, setShowLibrary] = useState(false);
  const [selectedModule, setSelectedModule] = useState<ModuleInstance | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<ModuleCategory>('aviation');
  const [editingModule, setEditingModule] = useState<ModuleInstance | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleModulePress = (module: ModuleInstance) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedModule(module);
  };

  const handleModuleLongPress = (module: ModuleInstance) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setSelectedModule(module);
    setIsDragging(true);
  };

  const handleGridPress = (x: number, y: number) => {
    if (isDragging && selectedModule) {
      // Move module to new position
      setModules(modules.map(m =>
        m.instanceId === selectedModule.instanceId
          ? { ...m, position: { x, y } }
          : m
      ));
      setIsDragging(false);
      setSelectedModule(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  const addModule = (definition: ModuleDefinition) => {
    // Find an empty spot
    let position = { x: 0, y: 0 };
    const size = SIZE_DIMENSIONS[definition.defaultSize];

    // Simple placement algorithm - find first available spot
    outer: for (let y = 0; y < GRID_ROWS; y++) {
      for (let x = 0; x <= GRID_COLS - size.cols; x++) {
        const conflicts = modules.some(m => {
          const mSize = SIZE_DIMENSIONS[m.size];
          return !(x + size.cols <= m.position.x ||
                   x >= m.position.x + mSize.cols ||
                   y + size.rows <= m.position.y ||
                   y >= m.position.y + mSize.rows);
        });
        if (!conflicts) {
          position = { x, y };
          break outer;
        }
      }
    }

    const newModule: ModuleInstance = {
      instanceId: generateInstanceId(),
      moduleId: definition.id,
      position,
      size: definition.defaultSize,
      config: definition.configFields.reduce((acc, field) => {
        if (field.default !== undefined) {
          acc[field.key] = field.default;
        }
        return acc;
      }, {} as Record<string, unknown>),
    };

    setModules([...modules, newModule]);
    setShowLibrary(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const removeModule = (instanceId: string) => {
    Alert.alert(
      'Remove Module',
      'Are you sure you want to remove this module?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            setModules(modules.filter(m => m.instanceId !== instanceId));
            setSelectedModule(null);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          },
        },
      ]
    );
  };

  const [saving, setSaving] = useState(false);

  const saveLayout = async () => {
    if (!user) {
      Alert.alert('Error', 'No user profile found');
      return;
    }

    setSaving(true);
    try {
      // Save to user-specific layout endpoint
      await api.updateUserLayout(user.id, modules);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Saved', `Layout saved for ${user.name}!`);
    } catch (error) {
      // Fall back to global layout if user endpoint fails
      try {
        const layout: MirrorLayout = {
          id: 'custom',
          name: 'Custom Layout',
          modules,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await api.updateLayout(layout);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Saved', 'Layout saved to mirror!');
      } catch {
        Alert.alert('Error', 'Failed to save layout. Make sure you are connected to the mirror.');
      }
    } finally {
      setSaving(false);
    }
  };

  // Load existing layout on mount
  useEffect(() => {
    const loadLayout = async () => {
      setIsLoading(true);
      try {
        // Try to load user-specific layout first
        if (user) {
          try {
            const userLayout = await api.getUserLayout(user.id);
            if (userLayout?.modules?.length > 0) {
              setModules(userLayout.modules);
              setLayoutName(userLayout.name || `${user.name}'s Layout`);
              setIsLoading(false);
              return;
            }
          } catch {
            // User layout not found, fall back to global
          }
        }

        // Fall back to global layout
        const layout = await api.getLayout();
        if (layout?.modules?.length > 0) {
          setModules(layout.modules);
          setLayoutName('Mirror Layout');
        } else {
          // Set default modules if no layout exists
          setModules([
            {
              instanceId: generateInstanceId(),
              moduleId: 'digital-clock',
              position: { x: 0, y: 0 },
              size: 'medium',
              config: { format24h: false, showSeconds: true, showDate: true },
            },
            {
              instanceId: generateInstanceId(),
              moduleId: 'metar',
              position: { x: 4, y: 0 },
              size: 'medium',
              config: { icao: 'KJFK', showDecoded: true },
            },
          ]);
          setLayoutName('New Layout');
        }
      } catch {
        // Use default layout if loading fails
        setModules([
          {
            instanceId: generateInstanceId(),
            moduleId: 'digital-clock',
            position: { x: 0, y: 0 },
            size: 'medium',
            config: {},
          },
        ]);
        setLayoutName('Default Layout');
      } finally {
        setIsLoading(false);
      }
    };
    loadLayout();
  }, [user]);

  // Apply template if templateId param is present
  useEffect(() => {
    if (params.templateId && !templateApplied) {
      const template = getTemplateById(params.templateId);
      if (template) {
        // Generate unique instanceIds and auto-fill airport for aviation modules
        const templateModules: ModuleInstance[] = template.modules.map(mod => ({
          ...mod,
          instanceId: generateInstanceId(),
          config: {
            ...mod.config,
            // Auto-fill ICAO for aviation modules if we have a configured airport
            ...(isAviationModule(mod.moduleId) && currentMirror?.mirrorName
              ? {} // Could auto-fill from user preferences in the future
              : {}),
          },
        }));
        setModules(templateModules);
        setLayoutName(`${template.name} Layout`);
        setTemplateApplied(true);
        setIsLoading(false);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    }
  }, [params.templateId, templateApplied, currentMirror]);

  const renderModulePreview = (module: ModuleInstance) => {
    const definition = getModuleById(module.moduleId);
    if (!definition) return null;

    const size = SIZE_DIMENSIONS[module.size];
    const isSelected = selectedModule?.instanceId === module.instanceId;
    const categoryInfo = CATEGORIES[definition.category];

    return (
      <TouchableOpacity
        key={module.instanceId}
        style={[
          styles.modulePreview,
          {
            left: module.position.x * CELL_SIZE,
            top: module.position.y * CELL_SIZE,
            width: size.cols * CELL_SIZE - 4,
            height: size.rows * CELL_SIZE - 4,
            borderColor: isSelected ? colors.primary : colors.border,
            backgroundColor: isSelected ? colors.primaryMuted : colors.surfaceElevated,
          },
        ]}
        onPress={() => handleModulePress(module)}
        onLongPress={() => handleModuleLongPress(module)}
        delayLongPress={300}
      >
        <View style={[styles.moduleIcon, { backgroundColor: categoryInfo.color + '30' }]}>
          <Ionicons
            name={definition.icon as any}
            size={16}
            color={categoryInfo.color}
          />
        </View>
        <Text style={styles.moduleName} numberOfLines={1}>
          {definition.name}
        </Text>
        {isSelected && (
          <View style={styles.moduleActions}>
            <TouchableOpacity
              style={styles.moduleAction}
              onPress={() => setEditingModule(module)}
            >
              <Ionicons name="settings-outline" size={14} color={colors.text} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.moduleAction}
              onPress={() => removeModule(module.instanceId)}
            >
              <Ionicons name="trash-outline" size={14} color={colors.error} />
            </TouchableOpacity>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const renderGrid = () => {
    const cells = [];
    for (let y = 0; y < GRID_ROWS; y++) {
      for (let x = 0; x < GRID_COLS; x++) {
        cells.push(
          <TouchableOpacity
            key={`${x}-${y}`}
            style={[
              styles.gridCell,
              {
                left: x * CELL_SIZE,
                top: y * CELL_SIZE,
                width: CELL_SIZE,
                height: CELL_SIZE,
              },
              isDragging && styles.gridCellDragging,
            ]}
            onPress={() => handleGridPress(x, y)}
          />
        );
      }
    }
    return cells;
  };

  // Show loading screen while fetching layout
  if (isLoading) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading layout...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerButton}>
          <Ionicons name="close" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Edit Layout</Text>
          {user && (
            <Text style={styles.headerSubtitle}>{user.name}'s Layout</Text>
          )}
        </View>
        <TouchableOpacity onPress={saveLayout} style={styles.headerButton} disabled={saving}>
          {saving ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Ionicons name="checkmark" size={24} color={colors.primary} />
          )}
        </TouchableOpacity>
      </View>

      {/* User info banner */}
      {user && currentMirror && (
        <View style={styles.userBanner}>
          <View style={styles.userAvatar}>
            <Text style={styles.userAvatarText}>{user.name.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={styles.userBannerInfo}>
            <Text style={styles.userBannerName}>Editing {user.name}'s layout</Text>
            <Text style={styles.userBannerMirror}>on {currentMirror.mirrorName}</Text>
          </View>
          <View style={styles.moduleCount}>
            <Text style={styles.moduleCountText}>{modules.length}</Text>
            <Text style={styles.moduleCountLabel}>modules</Text>
          </View>
        </View>
      )}

      {/* Mirror Preview */}
      <View style={styles.previewContainer}>
        <View style={styles.mirrorFrame}>
          <View style={styles.mirrorScreen}>
            {/* Grid overlay */}
            <View style={styles.grid}>
              {renderGrid()}
            </View>

            {/* Modules */}
            {modules.map(renderModulePreview)}
          </View>
        </View>

        {isDragging && (
          <View style={styles.dragHint}>
            <Ionicons name="move" size={16} color={colors.primary} />
            <Text style={styles.dragHintText}>Tap to place module</Text>
          </View>
        )}
      </View>

      {/* Toolbar */}
      <View style={styles.toolbar}>
        <TouchableOpacity
          style={styles.toolbarButton}
          onPress={() => setShowLibrary(true)}
        >
          <Ionicons name="add-circle" size={24} color={colors.primary} />
          <Text style={styles.toolbarButtonText}>Add</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.toolbarButton}
          onPress={() => {
            router.push({
              pathname: '/templates',
              params: { hasModules: modules.length > 0 ? 'true' : 'false' },
            });
          }}
        >
          <Ionicons name="copy-outline" size={24} color={colors.warning} />
          <Text style={styles.toolbarButtonText}>Templates</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.toolbarButton}
          onPress={() => {
            if (selectedModule) {
              setIsDragging(true);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            } else {
              Alert.alert('Select a Module', 'Tap a module first to move it');
            }
          }}
        >
          <Ionicons name="move" size={24} color={colors.accent} />
          <Text style={styles.toolbarButtonText}>Move</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.toolbarButton}
          onPress={() => {
            if (selectedModule) {
              setEditingModule(selectedModule);
            } else {
              Alert.alert('Select a Module', 'Tap a module first to configure it');
            }
          }}
        >
          <Ionicons name="settings" size={24} color={colors.textSecondary} />
          <Text style={styles.toolbarButtonText}>Configure</Text>
        </TouchableOpacity>
      </View>

      {/* Selected module info */}
      {selectedModule && !isDragging && (
        <View style={styles.selectionInfo}>
          <Text style={styles.selectionText}>
            {getModuleById(selectedModule.moduleId)?.name || 'Unknown'}
          </Text>
          <TouchableOpacity onPress={() => setSelectedModule(null)}>
            <Ionicons name="close-circle" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      )}

      {/* Module Library Modal */}
      <Modal
        visible={showLibrary}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        <View style={styles.libraryContainer}>
          <View style={styles.libraryHeader}>
            <Text style={styles.libraryTitle}>Add Module</Text>
            <TouchableOpacity onPress={() => setShowLibrary(false)}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          {/* Category tabs */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.categoryTabs}
            contentContainerStyle={styles.categoryTabsContent}
          >
            {Object.entries(CATEGORIES).map(([key, cat]) => (
              <TouchableOpacity
                key={key}
                style={[
                  styles.categoryTab,
                  selectedCategory === key && styles.categoryTabActive,
                ]}
                onPress={() => setSelectedCategory(key as ModuleCategory)}
              >
                <Ionicons
                  name={cat.icon as any}
                  size={18}
                  color={selectedCategory === key ? cat.color : colors.textMuted}
                />
                <Text
                  style={[
                    styles.categoryTabText,
                    selectedCategory === key && { color: cat.color },
                  ]}
                >
                  {cat.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Module list */}
          <ScrollView style={styles.moduleList}>
            {MODULES.filter(m => m.category === selectedCategory).map((module) => (
              <TouchableOpacity
                key={module.id}
                style={styles.libraryItem}
                onPress={() => addModule(module)}
              >
                <View
                  style={[
                    styles.libraryItemIcon,
                    { backgroundColor: CATEGORIES[module.category].color + '20' },
                  ]}
                >
                  <Ionicons
                    name={module.icon as any}
                    size={24}
                    color={CATEGORIES[module.category].color}
                  />
                </View>
                <View style={styles.libraryItemContent}>
                  <View style={styles.libraryItemHeader}>
                    <Text style={styles.libraryItemName}>{module.name}</Text>
                    {module.premium && (
                      <View style={styles.premiumBadge}>
                        <Ionicons name="star" size={10} color={colors.warning} />
                        <Text style={styles.premiumBadgeText}>PRO</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.libraryItemDescription}>
                    {module.description}
                  </Text>
                  <View style={styles.libraryItemSizes}>
                    {module.sizes.map((size) => (
                      <View key={size} style={styles.sizeTag}>
                        <Text style={styles.sizeTagText}>{size}</Text>
                      </View>
                    ))}
                  </View>
                </View>
                <Ionicons name="add-circle-outline" size={24} color={colors.primary} />
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </Modal>

      {/* Module Config Modal */}
      <Modal
        visible={editingModule !== null}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        {editingModule && (
          <ModuleConfigPanel
            module={editingModule}
            onSave={(config) => {
              setModules(modules.map(m =>
                m.instanceId === editingModule.instanceId
                  ? { ...m, config }
                  : m
              ));
              setEditingModule(null);
            }}
            onCancel={() => setEditingModule(null)}
            onChangeSize={(size) => {
              setModules(modules.map(m =>
                m.instanceId === editingModule.instanceId
                  ? { ...m, size }
                  : m
              ));
              setEditingModule({ ...editingModule, size });
            }}
          />
        )}
      </Modal>
    </View>
  );
}

// Module configuration panel component
function ModuleConfigPanel({
  module,
  onSave,
  onCancel,
  onChangeSize,
}: {
  module: ModuleInstance;
  onSave: (config: Record<string, unknown>) => void;
  onCancel: () => void;
  onChangeSize: (size: ModuleInstance['size']) => void;
}) {
  const definition = getModuleById(module.moduleId);
  const [config, setConfig] = useState(module.config);
  const [showAirportPicker, setShowAirportPicker] = useState(false);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [activeField, setActiveField] = useState<string | null>(null);

  if (!definition) return null;

  const renderConfigField = (field: typeof definition.configFields[0]) => {
    switch (field.type) {
      case 'boolean':
        return (
          <TouchableOpacity
            style={[
              styles.booleanToggle,
              !!config[field.key] && styles.booleanToggleActive,
            ]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setConfig({ ...config, [field.key]: !config[field.key] });
            }}
          >
            <Text style={styles.booleanToggleText}>
              {config[field.key] ? 'On' : 'Off'}
            </Text>
          </TouchableOpacity>
        );

      case 'select':
        return (
          <View style={styles.selectContainer}>
            {field.options?.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[
                  styles.selectOption,
                  config[field.key] === opt.value && styles.selectOptionActive,
                ]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setConfig({ ...config, [field.key]: opt.value });
                }}
              >
                <Text
                  style={[
                    styles.selectOptionText,
                    config[field.key] === opt.value && styles.selectOptionTextActive,
                  ]}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        );

      case 'number':
        return (
          <TextInput
            style={styles.textInput}
            value={config[field.key] !== undefined ? String(config[field.key]) : ''}
            onChangeText={(text) => {
              const num = parseFloat(text);
              setConfig({ ...config, [field.key]: isNaN(num) ? text : num });
            }}
            placeholder={field.placeholder || String(field.default || '')}
            placeholderTextColor={colors.textMuted}
            keyboardType="numeric"
          />
        );

      case 'airport':
        return (
          <TouchableOpacity
            style={styles.pickerButton}
            onPress={() => {
              setActiveField(field.key);
              setShowAirportPicker(true);
            }}
          >
            <Ionicons name="airplane" size={20} color={colors.primary} />
            <Text style={[styles.pickerButtonText, !config[field.key] && styles.pickerButtonPlaceholder]}>
              {config[field.key] ? String(config[field.key]) : 'Select Airport'}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        );

      case 'location':
        const locationValue = config[field.key] as LocationData | undefined;
        return (
          <TouchableOpacity
            style={styles.pickerButton}
            onPress={() => {
              setActiveField(field.key);
              setShowLocationPicker(true);
            }}
          >
            <Ionicons name="location" size={20} color={colors.accent} />
            <Text style={[styles.pickerButtonText, !locationValue && styles.pickerButtonPlaceholder]}>
              {locationValue
                ? locationValue.city || `${locationValue.latitude}, ${locationValue.longitude}`
                : 'Set Location'}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        );

      case 'color':
        return (
          <TouchableOpacity
            style={styles.pickerButton}
            onPress={() => {
              setActiveField(field.key);
              setShowColorPicker(true);
            }}
          >
            <View
              style={[
                styles.colorSwatch,
                { backgroundColor: String(config[field.key] || '#ffffff') },
              ]}
            />
            <Text style={[styles.pickerButtonText, !config[field.key] && styles.pickerButtonPlaceholder]}>
              {config[field.key] ? String(config[field.key]).toUpperCase() : 'Select Color'}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        );

      case 'text':
      default:
        return (
          <TextInput
            style={styles.textInput}
            value={config[field.key] !== undefined ? String(config[field.key]) : ''}
            onChangeText={(text) => setConfig({ ...config, [field.key]: text })}
            placeholder={field.placeholder || String(field.default || '')}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
          />
        );
    }
  };

  return (
    <View style={styles.configContainer}>
      <View style={styles.configHeader}>
        <TouchableOpacity onPress={onCancel}>
          <Text style={styles.configCancel}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.configTitle}>{definition.name}</Text>
        <TouchableOpacity onPress={() => onSave(config)}>
          <Text style={styles.configSave}>Save</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.configContent} keyboardShouldPersistTaps="handled">
        {/* Size selector */}
        <View style={styles.configSection}>
          <Text style={styles.configSectionTitle}>SIZE</Text>
          <View style={styles.sizeSelector}>
            {definition.sizes.map((size) => (
              <TouchableOpacity
                key={size}
                style={[
                  styles.sizeOption,
                  module.size === size && styles.sizeOptionActive,
                ]}
                onPress={() => onChangeSize(size)}
              >
                <Text
                  style={[
                    styles.sizeOptionText,
                    module.size === size && styles.sizeOptionTextActive,
                  ]}
                >
                  {size}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Config fields */}
        {definition.configFields.length > 0 && (
          <View style={styles.configSection}>
            <Text style={styles.configSectionTitle}>SETTINGS</Text>
            {definition.configFields.map((field) => (
              <View key={field.key} style={styles.configField}>
                <View style={styles.configFieldHeader}>
                  <Text style={styles.configFieldLabel}>{field.label}</Text>
                  {field.required && <Text style={styles.requiredBadge}>Required</Text>}
                </View>
                {field.description && (
                  <Text style={styles.configFieldDescription}>{field.description}</Text>
                )}
                {renderConfigField(field)}
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Pickers */}
      <AirportPicker
        visible={showAirportPicker}
        currentValue={activeField ? String(config[activeField] || '') : undefined}
        onSelect={(icao) => {
          if (activeField) {
            setConfig({ ...config, [activeField]: icao });
          }
          setShowAirportPicker(false);
          setActiveField(null);
        }}
        onClose={() => {
          setShowAirportPicker(false);
          setActiveField(null);
        }}
      />

      <LocationPicker
        visible={showLocationPicker}
        currentValue={activeField ? (config[activeField] as LocationData) : undefined}
        onSelect={(location) => {
          if (activeField) {
            setConfig({ ...config, [activeField]: location });
          }
          setShowLocationPicker(false);
          setActiveField(null);
        }}
        onClose={() => {
          setShowLocationPicker(false);
          setActiveField(null);
        }}
      />

      <ColorPicker
        visible={showColorPicker}
        currentValue={activeField ? String(config[activeField] || '') : undefined}
        onSelect={(color) => {
          if (activeField) {
            setConfig({ ...config, [activeField]: color });
          }
          setShowColorPicker(false);
          setActiveField(null);
        }}
        onClose={() => {
          setShowColorPicker(false);
          setActiveField(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.md,
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
    width: 44,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    ...typography.h3,
    color: colors.text,
  },
  headerSubtitle: {
    ...typography.caption,
    color: colors.primary,
    marginTop: 2,
  },
  userBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceElevated,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  userAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  userAvatarText: {
    ...typography.body,
    color: colors.background,
    fontWeight: '700',
    fontSize: 14,
  },
  userBannerInfo: {
    flex: 1,
  },
  userBannerName: {
    ...typography.bodySmall,
    color: colors.text,
    fontWeight: '500',
  },
  userBannerMirror: {
    ...typography.caption,
    color: colors.textMuted,
  },
  moduleCount: {
    alignItems: 'center',
    paddingHorizontal: spacing.md,
  },
  moduleCountText: {
    ...typography.h3,
    color: colors.primary,
  },
  moduleCountLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 10,
  },
  previewContainer: {
    flex: 1,
    padding: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mirrorFrame: {
    borderRadius: borderRadius.lg,
    borderWidth: 3,
    borderColor: colors.surfaceHighlight,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  mirrorScreen: {
    width: SCREEN_WIDTH - spacing.lg * 2,
    height: (SCREEN_WIDTH - spacing.lg * 2) / MIRROR_ASPECT,
    backgroundColor: colors.surface,
    position: 'relative',
  },
  grid: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  gridCell: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    opacity: 0.3,
  },
  gridCellDragging: {
    opacity: 0.8,
    backgroundColor: colors.primaryMuted,
  },
  modulePreview: {
    position: 'absolute',
    borderRadius: borderRadius.sm,
    borderWidth: 2,
    padding: spacing.xs,
    margin: 2,
  },
  moduleIcon: {
    width: 24,
    height: 24,
    borderRadius: borderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  moduleName: {
    ...typography.caption,
    color: colors.text,
    fontSize: 10,
  },
  moduleActions: {
    position: 'absolute',
    top: 2,
    right: 2,
    flexDirection: 'row',
    gap: 4,
  },
  moduleAction: {
    padding: 2,
    backgroundColor: colors.surfaceHighlight,
    borderRadius: borderRadius.sm,
  },
  dragHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
    padding: spacing.sm,
    backgroundColor: colors.primaryMuted,
    borderRadius: borderRadius.md,
  },
  dragHintText: {
    ...typography.bodySmall,
    color: colors.primary,
  },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  toolbarButton: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  toolbarButtonText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  selectionInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    backgroundColor: colors.surfaceElevated,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  selectionText: {
    ...typography.body,
    color: colors.text,
  },
  libraryContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  libraryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
    paddingTop: spacing.xl,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  libraryTitle: {
    ...typography.h2,
    color: colors.text,
  },
  categoryTabs: {
    maxHeight: 50,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  categoryTabsContent: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  categoryTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceElevated,
  },
  categoryTabActive: {
    backgroundColor: colors.primaryMuted,
  },
  categoryTabText: {
    ...typography.bodySmall,
    color: colors.textMuted,
  },
  moduleList: {
    flex: 1,
  },
  libraryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  libraryItemIcon: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  libraryItemContent: {
    flex: 1,
  },
  libraryItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  libraryItemName: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
  libraryItemDescription: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  libraryItemSizes: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  sizeTag: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    backgroundColor: colors.surfaceHighlight,
    borderRadius: borderRadius.sm,
  },
  sizeTagText: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 10,
  },
  premiumBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    backgroundColor: 'rgba(255, 170, 0, 0.2)',
    borderRadius: borderRadius.sm,
  },
  premiumBadgeText: {
    ...typography.caption,
    color: colors.warning,
    fontSize: 10,
    fontWeight: '700',
  },
  configContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  configHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
    paddingTop: spacing.xl,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  configCancel: {
    ...typography.body,
    color: colors.textMuted,
  },
  configTitle: {
    ...typography.h3,
    color: colors.text,
  },
  configSave: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '600',
  },
  configContent: {
    flex: 1,
  },
  configSection: {
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  configSectionTitle: {
    ...typography.label,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  sizeSelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  sizeOption: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sizeOptionActive: {
    backgroundColor: colors.primaryMuted,
    borderColor: colors.primary,
  },
  sizeOptionText: {
    ...typography.bodySmall,
    color: colors.textMuted,
  },
  sizeOptionTextActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  configField: {
    marginBottom: spacing.lg,
  },
  configFieldLabel: {
    ...typography.body,
    color: colors.text,
  },
  configFieldDescription: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  booleanToggle: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.md,
    alignSelf: 'flex-start',
  },
  booleanToggleActive: {
    backgroundColor: colors.primaryMuted,
  },
  booleanToggleText: {
    ...typography.bodySmall,
    color: colors.text,
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
    backgroundColor: colors.primaryMuted,
    borderColor: colors.primary,
  },
  selectOptionText: {
    ...typography.bodySmall,
    color: colors.textMuted,
  },
  selectOptionTextActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  textInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  textInputValue: {
    ...typography.body,
    color: colors.text,
  },
  textInput: {
    height: 48,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    ...typography.body,
  },
  pickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surfaceElevated,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pickerButtonText: {
    ...typography.body,
    color: colors.text,
    flex: 1,
  },
  pickerButtonPlaceholder: {
    color: colors.textMuted,
  },
  colorSwatch: {
    width: 24,
    height: 24,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  configFieldHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  requiredBadge: {
    ...typography.caption,
    color: colors.warning,
    fontSize: 10,
  },
});
