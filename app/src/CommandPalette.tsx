import { useEffect, useMemo, useState } from "react";
import { searchText, type SearchHit } from "./documentStore";
import type { Board } from "./model";

export type PaletteAction = {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
};

export function CommandPalette({
  open,
  onClose,
  actions,
  boards,
  onOpenDoc,
}: {
  open: boolean;
  onClose: () => void;
  actions: PaletteAction[];
  boards: Board[];
  onOpenDoc: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (!open) {
      setQuery("");
      setHits([]);
      setActive(0);
    }
  }, [open]);
  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setHits([]);
      return;
    }
    const timer = setTimeout(() => {
      void searchText(query).then(setHits).catch(() => setHits([]));
    }, 150);
    return () => clearTimeout(timer);
  }, [open, query]);
  const localCards = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return [];
    return boards.flatMap((board) =>
      board.columns.flatMap((column) =>
        column.tasks
          .filter((task) => (task.title + " " + task.description).toLowerCase().includes(needle))
          .map((task) => ({ id: task.id, label: task.title, hint: board.name })),
      ),
    );
  }, [boards, query]);
  const filtered = actions.filter((action) => action.label.toLowerCase().includes(query.trim().toLowerCase()));
  const rows = [
    ...filtered.map((action) => ({ key: action.id, label: action.label, hint: action.hint, run: action.run })),
    ...hits
      .filter((hit) => hit.kind === "doc")
      .map((hit) => ({ key: "doc-" + hit.id, label: hit.title, hint: "Документ", run: () => onOpenDoc(hit.id) })),
    ...localCards.map((card) => ({ key: "card-" + card.id, label: card.label, hint: card.hint, run: () => onClose() })),
  ];
  if (!open) return null;
  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-label="Командная палитра"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          autoFocus
          aria-label="Команда или поиск"
          placeholder="Команда, документ или карточка"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose();
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((index) => Math.min(index + 1, Math.max(rows.length - 1, 0)));
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((index) => Math.max(index - 1, 0));
            }
            if (event.key === "Enter" && rows[active]) {
              rows[active].run();
              onClose();
            }
          }}
        />
        <div className="palette-list">
          {rows.length === 0 && <p className="field-hint">Ничего не нашлось.</p>}
          {rows.map((row, index) => (
            <button
              key={row.key}
              type="button"
              className={index === active ? "is-active" : ""}
              onMouseEnter={() => setActive(index)}
              onClick={() => {
                row.run();
                onClose();
              }}
            >
              <strong>{row.label}</strong>
              {row.hint && <small>{row.hint}</small>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
