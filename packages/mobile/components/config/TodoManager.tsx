/**
 * To-do list manager for the to-do widget. Items live on the mirror
 * (/api/todos), not in the widget config, so every change here is sent
 * immediately and the mirror updates over its WebSocket. Updates are applied
 * optimistically and rolled back if the mirror rejects them.
 */

import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { SectionLabel, Spinner, Text, TextInput } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { api, type TodoItem } from '@/lib/api';
import { colors, spacing, borderRadius, typography, fonts } from '@/lib/theme';
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

  // On failure, undo only this item: restoring a snapshot of the whole list
  // would also throw away other changes made while this request was in flight.
  const toggle = async (item: TodoItem) => {
    Haptics.selectionAsync();
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, done: !item.done } : i)));
    try {
      const updated = await api.updateTodo(item.id, { done: !item.done });
      setItems((prev) => prev.map((i) => (i.id === item.id ? updated : i)));
    } catch (e) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? item : i)));
      setError(errorText(e, 'Couldn’t update item'));
    }
  };

  const remove = async (item: TodoItem) => {
    const index = items.findIndex((i) => i.id === item.id);
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    try {
      await api.deleteTodo(item.id);
    } catch (e) {
      setItems((prev) =>
        prev.some((i) => i.id === item.id)
          ? prev
          : [...prev.slice(0, Math.max(0, index)), item, ...prev.slice(Math.max(0, index))]
      );
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
        <Spinner style={styles.loader} />
      ) : (
        <>
          <View style={styles.header}>
            <SectionLabel style={styles.headerLabel}>Items</SectionLabel>
            <Text style={styles.count}>
              {items.length === 0 ? 'Nothing on the list.' : `${openCount} open · ${items.length - openCount} done`}
            </Text>
          </View>
          <View style={items.length > 0 ? styles.rows : null}>
          {items.map((item, index) => (
            <View key={item.id} style={styles.row}>
              <TouchableOpacity
                style={styles.check}
                onPress={() => toggle(item)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: item.done }}
                accessibilityLabel={item.text}
              >
                <View style={[styles.box, item.done && styles.boxDone]}>
                  {item.done ? <Ionicons name="checkmark" size={14} color={colors.onPrimary} /> : null}
                </View>
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
          </View>
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
            <Spinner />
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    paddingTop: spacing.md,
    marginBottom: spacing.sm,
  },
  headerLabel: { marginBottom: 0 },
  count: { ...typography.caption, fontFamily: fonts.mono, color: colors.textMuted },
  rows: { borderBottomWidth: 1, borderBottomColor: colors.hairline },
  row: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  check: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center', marginLeft: -12 },
  box: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.switchOffBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxDone: { backgroundColor: colors.primary, borderColor: colors.primary },
  text: { fontSize: 14, lineHeight: 20, color: colors.text, flex: 1, paddingVertical: spacing.sm },
  textDone: { color: colors.textMuted, textDecorationLine: 'line-through' },
  smallButton: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
  addRow: { flexDirection: 'row', gap: spacing.sm, marginTop: 14 },
  addInput: { flex: 1, minHeight: 48 },
  addButton: {
    minWidth: 64,
    height: 48,
    borderRadius: borderRadius.input,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  addButtonDisabled: { backgroundColor: colors.disabledFill },
  addButtonText: { fontSize: 14, fontWeight: '600', color: colors.onPrimary },
  addButtonTextDisabled: { color: colors.textDisabled },
});
