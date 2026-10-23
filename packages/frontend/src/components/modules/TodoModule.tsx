/**
 * To-do — a short list managed from the phone. Refreshes the moment the
 * backend broadcasts a change, with a slow poll as a fallback.
 */

import { ModuleProps } from './index';
import { ModuleEmpty, ModuleError, ModuleFrame, ModuleLoading } from './ModuleFrame';
import { useModuleData } from './useModuleData';
import { useWsEvent } from './useWsEvent';
import './TodoModule.css';

interface TodoItem {
  id: string;
  text: string;
  done: boolean;
  createdAt?: string;
  completedAt?: string | null;
}

interface TodosResponse {
  items: TodoItem[];
}

const ROW_CAP: Record<string, number> = { small: 2, medium: 4, tall: 8, large: 8 };

function CheckGlyph({ done }: { done: boolean }) {
  return (
    <svg className="todo-glyph" viewBox="0 0 16 16" aria-hidden="true">
      {done ? (
        <>
          <circle cx="8" cy="8" r="7" className="todo-glyph-fill" />
          <path d="M4.8 8.3l2.2 2.2 4.3-4.6" className="todo-glyph-check" />
        </>
      ) : (
        <circle cx="8" cy="8" r="6.4" className="todo-glyph-ring" />
      )}
    </svg>
  );
}

export function TodoModule({ config, size }: ModuleProps) {
  const title =
    typeof config.title === 'string' && config.title.trim() ? config.title.trim() : 'To-do';
  const showCompleted = config.showCompleted === true;
  const requested = Number(config.maxItems);
  const maxItems = Math.min(
    Number.isFinite(requested) && requested > 0 ? Math.round(requested) : 8,
    ROW_CAP[size] ?? 6
  );

  const { data, loading, error, refresh } = useModuleData<TodosResponse>('/api/todos', {
    refreshMs: 60_000,
  });
  useWsEvent('todos', () => {
    void refresh();
  });

  const all = data?.items ?? [];
  const open = all.filter((i) => !i.done);
  // Open items first; completed ones sink to the bottom when shown at all.
  const pool = showCompleted ? [...open, ...all.filter((i) => i.done)] : open;
  const items = pool.slice(0, maxItems);
  const hidden = pool.length - items.length;

  let body;
  if (loading) {
    body = <ModuleLoading />;
  } else if (!data && error) {
    body = <ModuleError title="List unavailable" hint="Will retry shortly" />;
  } else if (items.length === 0) {
    body = <ModuleEmpty title="All clear" />;
  } else {
    body = (
      <ul className="todo-list">
        {items.map((item) => (
          <li key={item.id} className={`todo-item${item.done ? ' done' : ''}`}>
            <CheckGlyph done={item.done} />
            <span className="todo-text">{item.text}</span>
          </li>
        ))}
      </ul>
    );
  }

  const meta = open.length > 0 ? <span className="mf-meta">{open.length}</span> : null;

  return (
    <ModuleFrame
      title={title}
      meta={meta}
      className="todo"
      footer={hidden > 0 ? `+${hidden} more` : undefined}
    >
      {body}
    </ModuleFrame>
  );
}
