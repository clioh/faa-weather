/**
 * To-do list manager for the to-do widget. Items live on the mirror
 * (/api/todos), not in the widget config, so every change here is sent
 * immediately and the mirror updates over its WebSocket. Updates are applied
 * optimistically and rolled back if the mirror rejects them.
 */

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { api, type TodoItem } from '@/lib/api';
import { colors, spacing, borderRadius, typography } from '@/lib/theme';
import { InlineError } from '../ErrorToast';
import { fieldStyles, TOUCH } from './fieldStyles';

const errorText = (e: unknown, fallback: string) => (e instanceof Error ? `${fallback}: ${e.message}` : fallback);

export function TodoManager() {
  const [items, setItems] = useState<TodoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await api.getTodos());
      setError(null);
    } catch (e) {
      setError(errorText(e, 'Couldn’t load to-dos'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const add = async () => {
    const text = draft.trim();
    if (!text || adding) return;
    setAdding(true);
    try {
      const item = await api.addTodo(text);
      setItems((prev) => [...prev, item]);
      setDraft('');
      setError(null);
      Haptics.selectionAsync();
    } catch (e) {
      setError(errorText(e, 'Couldn’t add item'));
    } finally {
      setAdding(false);
    }
  };

  const toggle = async (item: TodoItem) => {
    const before = items;
    Haptics.selectionAsync();
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)));
    try {
      const updated = await api.updateTodo(item.id, { done: !item.done });
      setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)));
    } catch (e) {
      setItems(before);
      setError(errorText(e, 'Couldn’t update item'));
    }
  };

  const remove = async (item: TodoItem) => {
    const before = items;
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    try {
      await api.deleteTodo(item.id);
    } catch (e) {
      setItems(before);
      setError(errorText(e, 'Couldn’t delete item'));
    }
  };

  const move = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= items.length) return;
    const before = items;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    Haptics.selectionAsync();
    setItems(next);
    try {
      setItems(await api.replaceTodos(next));
    } catch (e) {
      setItems(before);
      setError(errorText(e, 'Couldn’t reorder'));
    }
  };

  const openCount = items.filter((i) => !i.done).length;

  return (
    <View>
      {error && (
        <View style={styles.errorWrap}>
          <InlineError message={error} onDismiss={() => setError(null)} onRetry={load} />
        </View>
      )}

      {loading ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : (
        <>
          <Text style={styles.count}>
            {items.length === 0 ? 'Nothing on the list.' : `${openCount} open · ${items.length - openCount} done`}
          </Text>
          {items.map((item, index) => (
            <View key={item.id} style={styles.row}>
              <TouchableOpacity
                style={styles.check}
                onPress={() => toggle(item)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: item.done }}
                accessibilityLabel={item.text}
              >
                <Ionicons
                  name={item.done ? 'checkbox' : 'square-outline'}
                  size={22}
                  color={item.done ? colors.primary : colors.textSecondary}
                />
              </TouchableOpacity>
              <Text style={[styles.text, item.done && styles.textDone]} numberOfLines={3}>
                {item.text}
              </Text>
              <TouchableOpacity
                style={styles.smallButton}
                onPress={() => move(index, -1)}
                disabled={index === 0}
                accessibilityRole="button"
                accessibilityLabel={`Move ${item.text} up`}
              >
                <Ionicons name="chevron-up" size={18} color={index === 0 ? colors.textDisabled : colors.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.smallButton}
                onPress={() => move(index, 1)}
                disabled={index === items.length - 1}
                accessibilityRole="button"
                accessibilityLabel={`Move ${item.text} down`}
              >
                <Ionicons
                  name="chevron-down"
                  size={18}
                  color={index === items.length - 1 ? colors.textDisabled : colors.textSecondary}
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.smallButton}
                onPress={() => remove(item)}
                accessibilityRole="button"
                accessibilityLabel={`Delete ${item.text}`}
              >
                <Ionicons name="close" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          ))}
        </>
      )}

      <View style={styles.addRow}>
        <TextInput
          style={[fieldStyles.input, styles.addInput]}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={add}
          placeholder="Add an item"
          placeholderTextColor={colors.textMuted}
          returnKeyType="done"
          submitBehavior="submit"
          maxLength={200}
          accessibilityLabel="New to-do item"
        />
        <TouchableOpacity
          style={[styles.addButton, (!draft.trim() || adding) && styles.addButtonDisabled]}
          onPress={add}
          disabled={!draft.trim() || adding}
          accessibilityRole="button"
          accessibilityLabel="Add to-do item"
        >
          {adding ? (
            <ActivityIndicator size="small" color={colors.background} />
          ) : (
            <Text style={[styles.addButtonText, !draft.trim() && styles.addButtonTextDisabled]}>Add</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  errorWrap: { marginBottom: spacing.sm },
  loader: { paddingVertical: spacing.lg },
  count: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.xs },
  row: {
    minHeight: TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  check: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center', marginLeft: -spacing.sm },
  text: { ...typography.body, color: colors.text, flex: 1, paddingVertical: spacing.sm },
  textDone: { color: colors.textMuted, textDecorationLine: 'line-through' },
  smallButton: { width: 38, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
  addRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  addInput: { flex: 1 },
  addButton: {
    minWidth: 64,
    minHeight: TOUCH,
    borderRadius: borderRadius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  addButtonDisabled: { backgroundColor: colors.surfaceHighlight },
  addButtonText: { ...typography.body, fontWeight: '600', color: colors.background },
  addButtonTextDisabled: { color: colors.textDisabled },
});
