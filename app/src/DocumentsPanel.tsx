import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  backupBundle,
  deleteFolder,
  documentHistory,
  getAttachment,
  listDocuments,
  listFolders,
  putAttachment,
  saveDocument,
  saveFolder,
  searchText,
  type Document,
  type DocRevision,
  type Folder,
  type SearchHit,
} from "./documentStore";
import { Button } from "./components/ui/button";
import { desktop } from "./persistence";
import { invoke } from "@tauri-apps/api/core";
import { MarkdownEditor, type EditorMode } from "./markdown/MarkdownEditor";
import { MarkdownView } from "./markdown/MarkdownView";
import {
  parseChecklist,
  replaceChecklistLine,
  tableOfContents,
  templates,
  type CheckItem,
} from "./markdown/text";
import type { Board } from "./model";
import "./documents.css";

type Guard = { flush: () => Promise<boolean>; dirty: boolean };

export function Documents({
  onGuard,
  boards,
  onCreateCards,
  onToggleCard,
  onOpenCard,
}: {
  onGuard: (value: Guard | null) => void;
  boards: Board[];
  onCreateCards: (titles: string[]) => Promise<string[]>;
  onToggleCard: (cardId: string, checked: boolean) => Promise<void>;
  onOpenCard: (cardId: string) => void;
}) {
  const [docs, setDocs] = useState<Document[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [draft, setDraft] = useState<Document | null>(null);
  const current = useRef(draft);
  const saved = useRef<Document | null>(null);
  const inflight = useRef<Promise<boolean> | null>(null);
  const [status, setStatus] = useState("Открываем документы…");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<EditorMode>("visual");
  const [folderId, setFolderId] = useState<string | "all">("all");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [revisions, setRevisions] = useState<DocRevision[]>([]);
  const [images, setImages] = useState<Record<string, string>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const update = (doc: Document | null) => {
    current.current = doc;
    setDraft(doc);
  };
  const dirty =
    !!draft &&
    (draft.title !== saved.current?.title ||
      draft.markdown !== saved.current?.markdown ||
      draft.folderId !== saved.current?.folderId ||
      draft.linkedCardId !== saved.current?.linkedCardId ||
      draft.id !== saved.current?.id);
  const flush = useCallback(async function persist(): Promise<boolean> {
    if (inflight.current) {
      if (!(await inflight.current)) return false;
    }
    const doc = current.current;
    if (
      !doc ||
      (doc.id === saved.current?.id &&
        doc.title === saved.current.title &&
        doc.markdown === saved.current.markdown &&
        doc.folderId === saved.current.folderId &&
        doc.linkedCardId === saved.current.linkedCardId)
    )
      return true;
    if (!doc.title.trim()) {
      setError("Введите название документа.");
      return false;
    }
    const work = (async () => {
      setStatus("Сохраняем…");
      try {
        const revision = await saveDocument(doc);
        const confirmed = { ...doc, revision };
        saved.current = confirmed;
        setDocs((items) => [...items.filter((item) => item.id !== doc.id), confirmed]);
        if (current.current?.id === doc.id) update({ ...current.current, revision });
        setError("");
        setStatus(desktop ? "Сохранено на устройстве" : "Просмотр · до закрытия страницы");
        return true;
      } catch (reason) {
        setError(String(reason));
        setStatus("Не сохранено");
        return false;
      }
    })();
    inflight.current = work;
    let ok = false;
    try {
      ok = await work;
    } finally {
      inflight.current = null;
    }
    if (!ok) return false;
    return persist();
  }, []);
  const load = useCallback(async () => {
    try {
      const [items, nextFolders] = await Promise.all([listDocuments(), listFolders()]);
      setDocs(items);
      setFolders(nextFolders);
      setReady(true);
      setError("");
      setStatus(desktop ? "Локальные документы" : "Просмотр · без постоянного хранения");
    } catch (reason) {
      setError(String(reason));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const onExternal = () => void load();
    window.addEventListener("sreda-docs-changed", onExternal);
    return () => window.removeEventListener("sreda-docs-changed", onExternal);
  }, [load]);
  useEffect(() => {
    onGuard({ flush, dirty });
    return () => onGuard(null);
  }, [onGuard, flush, dirty]);
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => void flush(), 700);
    return () => clearTimeout(timer);
  }, [draft, dirty, flush]);
  useEffect(() => {
    const listener = (event: BeforeUnloadEvent) => {
      if (current.current && (current.current.title !== saved.current?.title || current.current.markdown !== saved.current?.markdown))
        event.preventDefault();
    };
    window.addEventListener("beforeunload", listener);
    return () => window.removeEventListener("beforeunload", listener);
  }, []);
  useEffect(() => {
    if (query.trim().length < 2) {
      setHits([]);
      return;
    }
    const timer = setTimeout(() => {
      void searchText(query).then(setHits).catch(() => setHits([]));
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);
  const select = async (doc: Document) => {
    if (!(await flush())) return;
    saved.current = doc;
    update(doc);
    setError("");
    setHistoryOpen(false);
  };
  const create = async (title = "Без названия", markdown = "", nextFolder?: string | null) => {
    if (!(await flush())) return;
    saved.current = null;
    update({
      id: crypto.randomUUID(),
      title,
      markdown,
      revision: 0,
      folderId: nextFolder ?? (folderId === "all" ? null : folderId),
    });
  };
  const visible = docs.filter((doc) => folderId === "all" || doc.folderId === folderId);
  const toc = useMemo(() => tableOfContents(draft?.markdown ?? ""), [draft?.markdown]);
  const checks = useMemo(() => parseChecklist(draft?.markdown ?? ""), [draft?.markdown]);
  const backlinks = docs.filter(
    (doc) => doc.id !== draft?.id && draft && doc.markdown.includes("[[" + draft.title + "]]"),
  );
  const resolveImage = (src: string) => images[src];
  useEffect(() => {
    const ids = [...(draft?.markdown.matchAll(/sreda-attachment:([A-Za-z0-9_-]+)/g) ?? [])].map((match) => match[1]);
    for (const id of ids) {
      const key = "sreda-attachment:" + id;
      if (images[key]) continue;
      void getAttachment(id).then((file) => {
        if (!file) return;
        setImages((currentImages) => ({ ...currentImages, [key]: `data:${file.mime};base64,${file.base64}` }));
      });
    }
  }, [draft?.markdown, images]);
  const pasteImage = async (file: File) => {
    if (!draft) return null;
    if (file.size > 4 * 1024 * 1024) {
      setError("Изображение больше 4 МБ.");
      return null;
    }
    if (!(await flush())) return null;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const id = await putAttachment(draft.id, file.type || "image/png", file.name || "image", bytes);
    const url = "sreda-attachment:" + id;
    const fileData = await getAttachment(id);
    if (fileData) setImages((currentImages) => ({ ...currentImages, [url]: `data:${fileData.mime};base64,${fileData.base64}` }));
    return url;
  };
  const download = async (kind: "md" | "html") => {
    if (!draft) return;
    if (kind === "md" && desktop) {
      try {
        await invoke("documents_export", { title: draft.title, markdown: draft.markdown });
      } catch (reason) {
        setError(String(reason));
      }
      return;
    }
    const text = kind === "md" ? draft.markdown : await htmlDocument(draft.title, draft.markdown);
    const blob = new Blob([text], { type: kind === "md" ? "text/markdown;charset=utf-8" : "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = (draft.title.replace(/[<>:"/\\|?*]/g, "_") || "Документ") + (kind === "md" ? ".md" : ".html");
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const printPdf = () => {
    document.body.classList.add("printing-doc");
    window.print();
    document.body.classList.remove("printing-doc");
  };
  const toggleCheck = async (item: CheckItem, checked: boolean) => {
    if (!draft) return;
    const next = replaceChecklistLine(draft.markdown, { ...item, checked });
    update({ ...draft, markdown: next });
    if (item.cardId) await onToggleCard(item.cardId, checked);
  };
  const makeCards = async () => {
    if (!draft) return;
    const open = checks.filter((item) => !item.checked && !item.cardId && item.text);
    if (!open.length) {
      setError("Нет свободных пунктов чек-листа.");
      return;
    }
    const ids = await onCreateCards(open.map((item) => item.text));
    let markdown = draft.markdown;
    open.forEach((item, index) => {
      if (ids[index]) markdown = replaceChecklistLine(markdown, { ...item, cardId: ids[index] });
    });
    update({ ...draft, markdown });
  };
  return (
    <section className="documents-area" aria-label="Документы">
      <nav className="documents-list" aria-label="Список документов">
        <h2>Документы</h2>
        <input
          aria-label="Поиск по документам и карточкам"
          placeholder="Поиск"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <label className="field">
          <span>Папка</span>
          <select value={folderId} onChange={(event) => setFolderId(event.target.value as typeof folderId)}>
            <option value="all">Все папки</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
        </label>
        <Button disabled={!ready} onClick={() => void create()}>
          Новый документ
        </Button>
        <Button
          variant="outline"
          disabled={!ready}
          onClick={async () => {
            const name = window.prompt("Название папки", "Новая папка");
            if (!name?.trim()) return;
            const folder: Folder = { id: crypto.randomUUID(), name: name.trim(), revision: 0 };
            await saveFolder(folder);
            setFolders(await listFolders());
          }}
        >
          Новая папка
        </Button>
        <Button
          variant="outline"
          disabled={!ready}
          onClick={async () => {
            if (!desktop) {
              fileInput.current?.click();
              return;
            }
            try {
              const file = await invoke<[string, string] | null>("documents_import");
              if (file) await create(file[0], file[1]);
            } catch (reason) {
              setError(String(reason));
            }
          }}
        >
          Импорт .md
        </Button>
        {desktop && (
          <Button
            variant="outline"
            onClick={async () => {
              try {
                const report = await invoke<{ exported: number; imported: number }>("documents_sync_vault");
                await load();
                setStatus(`Папка: выгружено ${report.exported}, прочитано ${report.imported}`);
              } catch (reason) {
                setError(String(reason));
              }
            }}
          >
            Папка на диске
          </Button>
        )}
        <input
          ref={fileInput}
          type="file"
          accept=".md,.markdown,text/markdown"
          hidden
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            if (file.size > 2 * 1024 * 1024) {
              setError("Файл больше 2 МБ.");
              return;
            }
            await create(file.name.replace(/\.(md|markdown)$/i, "").slice(0, 200) || "Документ", await file.text());
          }}
        />
        {hits.map((hit) => (
          <button
            key={hit.kind + hit.id}
            className="document-link"
            onClick={() => {
              const doc = docs.find((item) => item.id === hit.id);
              if (doc) void select(doc);
            }}
          >
            {hit.kind === "doc" ? hit.title : "Карточка · " + hit.title}
          </button>
        ))}
        {visible.map((doc) => (
          <button key={doc.id} className={"document-link " + (draft?.id === doc.id ? "active" : "")} onClick={() => void select(doc)}>
            {doc.title}
          </button>
        ))}
      </nav>
      <div className="document-editor">
        <div className="document-toolbar">
          <span role="status">{dirty ? "Есть несохранённые изменения" : status}</span>
          <Button variant="outline" disabled={!draft} aria-pressed={mode === "visual"} onClick={() => setMode(mode === "visual" ? "source" : "visual")}>
            {mode === "visual" ? "Исходный Markdown" : "Визуальный режим"}
          </Button>
          <Button variant="outline" disabled={!draft} onClick={() => void flush()}>
            Сохранить
          </Button>
          <Button variant="outline" disabled={!draft} onClick={() => void download("md")}>
            Экспорт .md
          </Button>
          <Button variant="outline" disabled={!draft} onClick={() => void download("html")}>
            Экспорт HTML
          </Button>
          <Button variant="outline" disabled={!draft} onClick={printPdf}>
            PDF
          </Button>
        </div>
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        {draft ? (
          <div className="document-layout">
            <div className="document-main">
              <input
                className="document-title"
                aria-label="Название документа"
                maxLength={200}
                value={draft.title}
                onChange={(event) => update({ ...draft, title: event.target.value })}
              />
              <div className="document-meta">
                <label>
                  Папка
                  <select
                    value={draft.folderId ?? ""}
                    onChange={(event) => update({ ...draft, folderId: event.target.value || null })}
                  >
                    <option value="">Без папки</option>
                    {folders.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Карточка
                  <select
                    value={draft.linkedCardId ?? ""}
                    onChange={(event) => update({ ...draft, linkedCardId: event.target.value || null })}
                  >
                    <option value="">Не связана</option>
                    {boards.flatMap((board) =>
                      board.columns.flatMap((column) =>
                        column.tasks.map((task) => (
                          <option key={task.id} value={task.id}>
                            {board.name} · {task.title}
                          </option>
                        )),
                      ),
                    )}
                  </select>
                </label>
                <label>
                  Шаблон
                  <select
                    defaultValue=""
                    onChange={(event) => {
                      const template = templates.find((item) => item.id === event.target.value);
                      if (template) update({ ...draft, markdown: draft.markdown ? draft.markdown + "\n" + template.markdown : template.markdown });
                      event.target.value = "";
                    }}
                  >
                    <option value="">Вставить шаблон</option>
                    {templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <MarkdownEditor
                value={draft.markdown}
                mode={mode}
                onChange={(markdown) => update({ ...current.current!, markdown })}
                onPasteImage={pasteImage}
              />
              <div className="print-doc" hidden>
                <h1>{draft.title}</h1>
                <MarkdownView markdown={draft.markdown} resolveImage={resolveImage} />
              </div>
            </div>
            <aside className="document-side">
              <h3>Оглавление</h3>
              {toc.length === 0 && <p className="field-hint">Заголовки появятся здесь.</p>}
              {toc.map((item) => (
                <div key={item.id} className={"toc-item toc-" + item.level}>
                  {item.text}
                </div>
              ))}
              <h3>Чек-лист</h3>
              {checks.map((item) => (
                <label key={item.line} className="check-row">
                  <input type="checkbox" checked={item.checked} onChange={(event) => void toggleCheck(item, event.target.checked)} />
                  <span>{item.text}</span>
                </label>
              ))}
              <Button variant="outline" onClick={() => void makeCards()}>
                Создать карточки
              </Button>
              <h3>Обратные ссылки</h3>
              {backlinks.length === 0 && <p className="field-hint">Пока никто не ссылается через [[{draft.title}]].</p>}
              {backlinks.map((doc) => (
                <button key={doc.id} className="document-link" onClick={() => void select(doc)}>
                  {doc.title}
                </button>
              ))}
              <h3>История</h3>
              <Button
                variant="outline"
                onClick={async () => {
                  setHistoryOpen(true);
                  setRevisions(await documentHistory(draft.id));
                }}
              >
                Версии
              </Button>
              {historyOpen &&
                revisions.map((revision) => (
                  <button
                    key={revision.id}
                    className="document-link"
                    onClick={() => update({ ...draft, title: revision.title, markdown: revision.markdown })}
                  >
                    {new Date(revision.createdAt).toLocaleString("ru")}
                  </button>
                ))}
              {draft.linkedCardId && (
                <Button variant="outline" onClick={() => onOpenCard(draft.linkedCardId!)}>
                  Открыть карточку
                </Button>
              )}
              {draft.folderId && (
                <Button
                  variant="outline"
                  onClick={async () => {
                    await deleteFolder(draft.folderId!);
                    setFolders(await listFolders());
                    update({ ...draft, folderId: null });
                  }}
                >
                  Удалить папку
                </Button>
              )}
            </aside>
          </div>
        ) : (
          <div className="empty-screen">
            <h1>Место для ваших заметок</h1>
            <p>Создайте документ, вставьте шаблон или импортируйте Markdown.</p>
          </div>
        )}
      </div>
    </section>
  );
}

async function htmlDocument(title: string, markdown: string) {
  if (desktop) {
    try {
      return await invoke<string>("documents_render_html", { title, markdown });
    } catch {
      /* browser fallback below */
    }
  }
  const escaped = markdown.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>${title}</title></head><body><pre>${escaped}</pre></body></html>`;
}

export { backupBundle };
