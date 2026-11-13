import { useCallback, useEffect, useRef, useState } from "react";
import { listDocuments, saveDocument, type Document } from "./documentStore";
import { Button } from "./components/ui/button";
import { desktop } from "./persistence";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { invoke } from "@tauri-apps/api/core";
import "./documents.css";

type Guard = { flush: () => Promise<boolean>; dirty: boolean };
export function Documents({
  onGuard,
}: {
  onGuard: (value: Guard | null) => void;
}) {
  const [docs, setDocs] = useState<Document[]>([]);
  const [draft, setDraft] = useState<Document | null>(null);
  const current = useRef(draft);
  const saved = useRef<Document | null>(null);
  const inflight = useRef<Promise<boolean> | null>(null);
  const [status, setStatus] = useState("Открываем документы…");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [preview, setPreview] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const update = (doc: Document | null) => {
    current.current = doc;
    setDraft(doc);
  };
  const dirty =
    !!draft &&
    (draft.title !== saved.current?.title ||
      draft.markdown !== saved.current?.markdown ||
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
        doc.markdown === saved.current.markdown)
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
        setDocs((items) => [
          ...items.filter((item) => item.id !== doc.id),
          confirmed,
        ]);
        if (current.current?.id === doc.id)
          update({ ...current.current, revision });
        setError("");
        setStatus(
          desktop
            ? "Сохранено на устройстве"
            : "Просмотр · до закрытия страницы",
        );
        return true;
      } catch (e) {
        setError(String(e));
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
      const items = await listDocuments();
      setDocs(items);
      setReady(true);
      setError("");
      setStatus(
        desktop ? "Локальные документы" : "Просмотр · без постоянного хранения",
      );
    } catch (e) {
      setError(String(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    onGuard({ flush, dirty });
    return () => onGuard(null);
  }, [onGuard, flush, dirty]);
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => {
      void flush();
    }, 700);
    return () => clearTimeout(timer);
  }, [draft, dirty, flush]);
  useEffect(() => {
    const listener = (e: BeforeUnloadEvent) => {
      if (
        current.current &&
        (current.current.title !== saved.current?.title ||
          current.current.markdown !== saved.current?.markdown)
      )
        e.preventDefault();
    };
    window.addEventListener("beforeunload", listener);
    return () => window.removeEventListener("beforeunload", listener);
  }, []);
  const select = async (doc: Document) => {
    if (!(await flush())) return;
    if (current.current?.id === doc.id) return;
    saved.current = doc;
    update(doc);
    setError("");
  };
  const create = async (title = "Без названия", markdown = "") => {
    if (!(await flush())) return;
    saved.current = null;
    update({ id: crypto.randomUUID(), title, markdown, revision: 0 });
  };
  const download = async () => {
    if (!draft) return;
    if (desktop) {
      try {
        await invoke("documents_export", {
          title: draft.title,
          markdown: draft.markdown,
        });
      } catch (e) {
        setError(String(e));
      }
      return;
    }
    const url = URL.createObjectURL(
      new Blob([draft.markdown], { type: "text/markdown;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download =
      (draft.title.replace(/[<>:"/\\|?*]/g, "_") || "Документ") + ".md";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section className="documents-area" aria-label="Документы">
      <nav className="documents-list" aria-label="Список документов">
        <h2>Документы</h2>
        <Button disabled={!ready} onClick={() => void create()}>
          Новый документ
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
              const file = await invoke<[string, string] | null>(
                "documents_import",
              );
              if (file) await create(file[0], file[1]);
            } catch (e) {
              setError(String(e));
            }
          }}
        >
          Импорт .md
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".md,.markdown,text/markdown"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            if (file.size > 2 * 1024 * 1024) {
              setError("Файл больше 2 МБ.");
              return;
            }
            try {
              await create(
                file.name.replace(/\.(md|markdown)$/i, "").slice(0, 200) ||
                  "Документ",
                await file.text(),
              );
            } catch (err) {
              setError(String(err));
            }
          }}
        />
        {docs.map((doc) => (
          <button
            className={
              "document-link " + (draft?.id === doc.id ? "active" : "")
            }
            key={doc.id}
            onClick={() => void select(doc)}
          >
            {doc.title}
          </button>
        ))}
      </nav>
      <div className="document-editor">
        <div className="document-toolbar">
          <span role="status">
            {dirty ? "Есть несохранённые изменения" : status}
          </span>
          <Button
            variant="outline"
            disabled={!draft}
            aria-pressed={preview}
            onClick={() => setPreview(!preview)}
          >
            {preview ? "Редактировать Markdown" : "Предпросмотр"}
          </Button>
          <Button
            variant="outline"
            disabled={!draft}
            onClick={() => void flush()}
          >
            Сохранить
          </Button>
          <Button variant="outline" disabled={!draft} onClick={download}>
            Экспорт .md
          </Button>
        </div>
        {error && (
          <div className="error-banner" role="alert">
            {error}
            <Button variant="outline" onClick={() => void flush()}>
              Повторить запись
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                if (
                  dirty &&
                  !window.confirm(
                    "Перечитать документы с диска и отбросить черновик? Сначала можно экспортировать его в .md.",
                  )
                )
                  return;
                if (inflight.current) await inflight.current;
                try {
                  const items = await listDocuments();
                  const selected =
                    items.find((item) => item.id === current.current?.id) ??
                    null;
                  setDocs(items);
                  saved.current = selected;
                  update(selected);
                  setError("");
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              Перечитать с диска
            </Button>
          </div>
        )}
        {!ready && (
          <Button onClick={() => void load()}>Повторить загрузку</Button>
        )}
        {draft ? (
          <>
            <input
              className="document-title"
              aria-label="Название документа"
              maxLength={200}
              value={draft.title}
              onChange={(e) => update({ ...draft, title: e.target.value })}
            />
            <label className="document-source-label" htmlFor="document-source">
              Markdown
            </label>
            {preview ? (
              <article className="document-preview">
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: ({ href, children }) => (
                      <a href={href} target="_blank" rel="noopener noreferrer">
                        {children}
                      </a>
                    ),
                  }}
                >
                  {draft.markdown || "*Документ пока пуст.*"}
                </Markdown>
              </article>
            ) : (
              <textarea
                id="document-source"
                className="document-source"
                spellCheck={false}
                value={draft.markdown}
                onChange={(e) => update({ ...draft, markdown: e.target.value })}
                placeholder="# Начните писать"
              />
            )}
          </>
        ) : (
          <div className="empty-screen">
            <h1>Место для ваших заметок</h1>
            <p>Создайте документ или импортируйте Markdown-файл.</p>
          </div>
        )}
      </div>
    </section>
  );
}
