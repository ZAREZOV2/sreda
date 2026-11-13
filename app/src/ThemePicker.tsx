import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Download, Upload, X } from "lucide-react";
import { Button } from "./components/ui/button";
import {
  BUILTIN_THEMES,
  applyTheme,
  loadUserThemes,
  parseThemeText,
  pickThemeExport,
  pickThemeImport,
  removeUserTheme,
  saveUiPrefs,
  saveUserTheme,
  swatchesFor,
  themeKey,
  themesDirPath,
  type ThemeRecord,
} from "./theme";

function onOpenAutoFocus(event: Event) {
  event.preventDefault();
}

function ThemePickerBody({
  currentKey,
  groups,
  dir,
  error,
  busy,
  select,
  onImport,
  onExport,
  onRemove,
  showLead,
}: {
  currentKey: string;
  groups: { title: string; items: ThemeRecord[] }[];
  dir: string | null;
  error: string;
  busy: boolean;
  select: (record: ThemeRecord) => void;
  onImport: () => void;
  onExport: () => void;
  onRemove: (record: ThemeRecord) => void;
  showLead?: boolean;
}) {
  return (
    <>
      {showLead && (
        <p className="theme-dialog-lead">
          Тема меняется сразу на доске. Свои темы можно импортировать и
          экспортировать файлом <code>*.sreda-theme.json</code>.
        </p>
      )}
      {groups.map((group) =>
        group.items.length === 0 && group.title === "Ваши темы" ? null : (
          <section key={group.title} className="theme-group">
            <h3>{group.title}</h3>
            {group.items.length === 0 ? (
              <p className="theme-empty">Пока нет импортированных тем.</p>
            ) : (
              <div className="theme-grid">
                {group.items.map((record) => {
                  const selected = themeKey(record) === currentKey;
                  const swatches = swatchesFor(record.theme);
                  return (
                    <div
                      key={themeKey(record)}
                      className={"theme-card" + (selected ? " is-selected" : "")}
                    >
                      <button
                        type="button"
                        className="theme-card-button"
                        onClick={() => select(record)}
                        disabled={busy}
                      >
                        <span className="theme-swatches" aria-hidden>
                          {swatches.map((color, i) => (
                            <i key={i} style={{ background: color }} />
                          ))}
                        </span>
                        <strong>{record.theme.name}</strong>
                        <small>
                          {record.theme.base === "light" ? "светлая" : "тёмная"}
                          {record.theme.description
                            ? " · " + record.theme.description
                            : ""}
                        </small>
                      </button>
                      {record.source === "user" && (
                        <button
                          type="button"
                          className="theme-card-remove"
                          aria-label={"Удалить тему «" + record.theme.name + "»"}
                          disabled={busy}
                          onClick={() => void onRemove(record)}
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        ),
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="modal-buttons theme-picker-actions">
        <Button variant="outline" disabled={busy} onClick={() => void onImport()}>
          <Upload size={14} />
          Импортировать
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => void onExport()}>
          <Download size={14} />
          Экспортировать текущую
        </Button>
      </div>
      {dir && (
        <p className="theme-dir" title={dir}>
          Папка ваших тем: {dir}
        </p>
      )}
    </>
  );
}

export function ThemePicker({
  open,
  onOpenChange,
  currentKey,
  onSelect,
  embedded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentKey: string;
  onSelect: (record: ThemeRecord) => void;
  embedded?: boolean;
}) {
  const [userThemes, setUserThemes] = useState<ThemeRecord[]>([]);
  const [dir, setDir] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setUserThemes(await loadUserThemes());
    setDir(await themesDirPath());
  };

  useEffect(() => {
    if (open) void refresh();
  }, [open]);

  const groups = useMemo(
    () => [
      { title: "Стартовые", items: BUILTIN_THEMES },
      { title: "Ваши темы", items: userThemes },
    ],
    [userThemes],
  );

  const current =
    BUILTIN_THEMES.find((t) => themeKey(t) === currentKey) ??
    userThemes.find((t) => themeKey(t) === currentKey) ??
    BUILTIN_THEMES[0];

  const select = (record: ThemeRecord) => {
    applyTheme(record.theme);
    onSelect(record);
    void saveUiPrefs({ themeId: themeKey(record) });
    setError("");
  };

  const onImport = async () => {
    setBusy(true);
    setError("");
    try {
      const text = await pickThemeImport();
      if (!text) return;
      const parsed = parseThemeText(text);
      if (!parsed.ok) {
        setError(parsed.errors.map((e) => e.message).join(". "));
        return;
      }
      const filename = await saveUserTheme(parsed.theme);
      const record: ThemeRecord = {
        source: "user",
        id: filename,
        theme: parsed.theme,
      };
      await refresh();
      select(record);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onExport = async () => {
    setBusy(true);
    setError("");
    try {
      await pickThemeExport(current.theme);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (record: ThemeRecord) => {
    setBusy(true);
    setError("");
    try {
      await removeUserTheme(record.id);
      await refresh();
      if (themeKey(record) === currentKey) {
        select(BUILTIN_THEMES[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <ThemePickerBody
      currentKey={currentKey}
      groups={groups}
      dir={dir}
      error={error}
      busy={busy}
      select={select}
      onImport={onImport}
      onExport={onExport}
      onRemove={onRemove}
      showLead={!embedded}
    />
  );

  if (embedded) {
    return open ? <div className="theme-picker-embedded">{body}</div> : null;
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="info-dialog theme-dialog"
          onOpenAutoFocus={onOpenAutoFocus}
        >
          <div className="modal-heading">
            <div>
              <span className="dialog-label">ОФОРМЛЕНИЕ</span>
              <Dialog.Title>Темы</Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Закрыть">
                <X size={16} />
              </Button>
            </Dialog.Close>
          </div>
          {body}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
