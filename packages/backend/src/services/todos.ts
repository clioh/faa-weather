/**
 * Todo list storage (data/todos.json).
 * Small JSON file, rewritten atomically on every change.
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export const MAX_TODOS = 200;
export const MAX_TODO_TEXT = 500;

export interface TodoItem {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
  completedAt: string | null;
}

export class TodoNotFoundError extends Error {
  constructor() {
    super('Todo not found');
    this.name = 'TodoNotFoundError';
  }
}

export class TodoLimitError extends Error {
  constructor() {
    super(`Todo list is limited to ${MAX_TODOS} items`);
    this.name = 'TodoLimitError';
  }
}

function isTodo(v: unknown): v is TodoItem {
  if (!v || typeof v !== 'object') return false;
  const t = v as Record<string, unknown>;
  return typeof t.id === 'string' && typeof t.text === 'string' && typeof t.done === 'boolean';
}

export class TodoStore {
  constructor(private readonly filePath: string) {}

  list(): TodoItem[] {
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as unknown;
      const items = Array.isArray(raw) ? raw : (raw as { items?: unknown })?.items;
      if (!Array.isArray(items)) return [];
      return items.filter(isTodo).map((t) => ({
        id: t.id,
        text: t.text,
        done: t.done,
        createdAt: typeof t.createdAt === 'string' ? t.createdAt : new Date(0).toISOString(),
        completedAt: t.done && typeof t.completedAt === 'string' ? t.completedAt : null,
      }));
    } catch {
      return [];
    }
  }

  private save(items: TodoItem[]): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ items }, null, 2));
    fs.renameSync(tmp, this.filePath);
  }

  add(text: string): TodoItem {
    const items = this.list();
    if (items.length >= MAX_TODOS) throw new TodoLimitError();
    const item: TodoItem = {
      id: randomUUID(),
      text: text.trim(),
      done: false,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };
    items.push(item);
    this.save(items);
    return item;
  }

  update(id: string, patch: { text?: string; done?: boolean }): TodoItem {
    const items = this.list();
    const item = items.find((t) => t.id === id);
    if (!item) throw new TodoNotFoundError();
    if (patch.text !== undefined) item.text = patch.text.trim();
    if (patch.done !== undefined && patch.done !== item.done) {
      item.done = patch.done;
      item.completedAt = patch.done ? new Date().toISOString() : null;
    }
    this.save(items);
    return item;
  }

  remove(id: string): void {
    const items = this.list();
    const next = items.filter((t) => t.id !== id);
    if (next.length === items.length) throw new TodoNotFoundError();
    this.save(next);
  }

  /**
   * Replace the list (reorder / bulk edit). Existing ids keep their
   * createdAt/completedAt; unknown ids are created.
   */
  replace(input: Array<{ id: string; text: string; done: boolean }>): TodoItem[] {
    if (input.length > MAX_TODOS) throw new TodoLimitError();
    const existing = new Map(this.list().map((t) => [t.id, t]));
    const now = new Date().toISOString();
    const seen = new Set<string>();
    const items: TodoItem[] = [];
    for (const t of input) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      const prev = existing.get(t.id);
      items.push({
        id: t.id,
        text: t.text.trim(),
        done: t.done,
        createdAt: prev?.createdAt ?? now,
        completedAt: t.done ? ((prev?.done ? prev.completedAt : null) ?? now) : null,
      });
    }
    this.save(items);
    return items;
  }
}
