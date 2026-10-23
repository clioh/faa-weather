import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { TodoStore, TodoNotFoundError, MAX_TODOS, TodoLimitError } from './todos.js';

describe('TodoStore', () => {
  let dir: string;
  let file: string;
  let store: TodoStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skyglass-todos-'));
    file = path.join(dir, 'nested', 'todos.json');
    store = new TodoStore(file);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('starts empty when the file is missing or corrupt', () => {
    expect(store.list()).toEqual([]);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{not json');
    expect(store.list()).toEqual([]);
  });

  it('creates, updates, completes and deletes items', () => {
    const a = store.add('  Preflight checklist  ');
    expect(a).toMatchObject({ text: 'Preflight checklist', done: false, completedAt: null });
    expect(a.id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    const b = store.add('File flight plan');
    expect(store.list().map((t) => t.id)).toEqual([a.id, b.id]);

    const done = store.update(a.id, { done: true });
    expect(done.done).toBe(true);
    expect(done.completedAt).not.toBeNull();
    const renamed = store.update(a.id, { text: 'Preflight' });
    expect(renamed.completedAt).toBe(done.completedAt);
    expect(store.update(a.id, { done: false }).completedAt).toBeNull();

    store.remove(b.id);
    expect(store.list().map((t) => t.id)).toEqual([a.id]);

    // persisted on disk
    expect(new TodoStore(file).list()[0].text).toBe('Preflight');
  });

  it('throws not found for unknown ids', () => {
    expect(() => store.update('nope', { done: true })).toThrow(TodoNotFoundError);
    expect(() => store.remove('nope')).toThrow(TodoNotFoundError);
  });

  it('replaces/reorders while keeping timestamps', () => {
    const a = store.add('A');
    const b = store.add('B');
    store.update(b.id, { done: true });
    const completedAt = store.list()[1].completedAt;
    const items = store.replace([
      { id: b.id, text: 'B', done: true },
      { id: a.id, text: 'A2', done: false },
      { id: 'new-1', text: 'C', done: false },
      { id: a.id, text: 'dup ignored', done: true },
    ]);
    expect(items.map((t) => t.id)).toEqual([b.id, a.id, 'new-1']);
    expect(items[0].completedAt).toBe(completedAt);
    expect(items[1]).toMatchObject({ text: 'A2', createdAt: a.createdAt });
    expect(store.list()).toEqual(items);
  });

  it('enforces the item limit', () => {
    const many = Array.from({ length: MAX_TODOS }, (_, i) => ({
      id: `t${i}`,
      text: `t${i}`,
      done: false,
    }));
    store.replace(many);
    expect(() => store.add('one too many')).toThrow(TodoLimitError);
    expect(() => store.replace([...many, { id: 'x', text: 'x', done: false }])).toThrow(
      TodoLimitError
    );
  });
});
