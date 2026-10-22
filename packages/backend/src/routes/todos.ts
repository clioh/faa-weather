/**
 * Todo API Routes (data/todos.json)
 * Every change broadcasts WS { type: 'todos', data: { items } }.
 */

import { Router } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateBody } from '../middleware/validate.js';
import { createTodoSchema, replaceTodosSchema, updateTodoSchema } from '../validation/schemas.js';
import { TodoLimitError, TodoNotFoundError, TodoStore, type TodoItem } from '../services/todos.js';
import { isSafeId } from '../validation/safe-id.js';
import { broadcast } from '../server.js';

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../../../data');
const store = new TodoStore(path.join(DATA_DIR, 'todos.json'));

function notify(items: TodoItem[]): void {
  broadcast('todos', { items });
}

function handleError(error: unknown, res: import('express').Response): void {
  if (error instanceof TodoNotFoundError) {
    res.status(404).json({ error: error.message });
  } else if (error instanceof TodoLimitError) {
    res.status(400).json({ error: error.message });
  } else {
    console.error('Todos route error:', error);
    res.status(500).json({ error: 'Failed to update todos' });
  }
}

router.get('/', (_req, res) => {
  res.json({ items: store.list() });
});

router.post('/', validateBody(createTodoSchema), (req, res) => {
  try {
    const item = store.add(req.body.text);
    notify(store.list());
    res.status(201).json({ item });
  } catch (error) {
    handleError(error, res);
  }
});

router.put('/', validateBody(replaceTodosSchema), (req, res) => {
  try {
    const items = store.replace(req.body.items);
    notify(items);
    res.json({ items });
  } catch (error) {
    handleError(error, res);
  }
});

router.patch('/:id', validateBody(updateTodoSchema), (req, res) => {
  if (!isSafeId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    const item = store.update(req.params.id, req.body);
    notify(store.list());
    res.json({ item });
  } catch (error) {
    handleError(error, res);
  }
});

router.delete('/:id', (req, res) => {
  if (!isSafeId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  try {
    store.remove(req.params.id);
    notify(store.list());
    res.json({ success: true });
  } catch (error) {
    handleError(error, res);
  }
});

export default router;
