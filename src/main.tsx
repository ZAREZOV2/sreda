import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as Dialog from "@radix-ui/react-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createCommandQueue } from "./commands";
import type { Commit } from "./commands";
import {
  Plus,
  Palette,
  Search,
  ChevronRight,
  MoreHorizontal,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Minus,
  Check,
  CheckCheck,
  CircleDashed,
  CircleDot,
  SlidersHorizontal,
  LockKeyhole,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  LayoutGrid,
  Trash2,
  Download,
  Upload,
  Pencil,
  GripVertical,
  Undo2,
  AlertCircle,
  LoaderCircle,
  Share2,
  Link2,
  Settings as SettingsIcon,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { ActionMenu } from "./ActionMenu";
import {
  boardFile,
  colors,
  columnKindNames,
  columnKinds,
  deletedTask,
  emptyWorkspace,
  exampleBoard,
  findTask,
  importBackupBoards,
  importCopy,
  newBoard,
  uid,
} from "./model";
import type { Board, DeletedTask, Priority, Snapshot, Task } from "./model";
import {
  applyInvite,
  disconnectedHint,
  parseInviteLink,
  type GuestBoard,
} from "./share";
import * as storage from "./persistence";
import * as collabApi from "./collab/api";
import { CollabClient, createGuestId } from "./collab/client";
import { applyHostClosed } from "./collab/closeFlow";
import {
  HostClosedDialog,
  JoinDialog,
  SharePanel,
  type HostStatus,
  type ShareSettings,
} from "./collab/SharePanel";
import {
  initialCollabState,
  nextBackoffMs,
  reduceCollab,
  shouldAutoReconnect,
  type CollabEvent,
  type CollabState,
} from "./collab/reducer";
import { BrandMark } from "./BrandMark";
import { ThemePicker } from "./ThemePicker";
import { SettingsDialog, type SettingsSection } from "./Settings";
import {
  defaultProfile,
  initials,
  type Profile,
} from "./profile";
import {
  BUILTIN_THEMES,
  DEFAULT_THEME_ID,
  applyTheme,
  findBuiltin,
  loadUiPrefs,
  loadUserThemes,
  parseThemeKey,
  saveUiPrefs,
  themeKey as themeRecordKey,
} from "./theme";
import "./tokens.css";
import "./styles.css";
import "./local.css";

import firstRunSvg from "./assets/illustrations/first-run.svg?raw";

function bootTheme() {
  try {
    const stored = localStorage.getItem("sreda.theme-id") || DEFAULT_THEME_ID;
    const builtin = findBuiltin(parseThemeKey(stored).id);
    if (builtin) applyTheme(builtin.theme);
  } catch {
    applyTheme(BUILTIN_THEMES[0].theme);
  }
}
bootTheme();

const priorityNames = { high: "Высокий", medium: "Обычный", low: "Низкий" };
const colorNames = {
  sage: "Зелёная",
  blue: "Синяя",
  amber: "Янтарная",
  rose: "Розовая",
  violet: "Фиолетовая",
  gray: "Серая",
};
function PriorityIcon({ value }: { value: Priority }) {
  const Icon =
    value === "high" ? ArrowUp : value === "medium" ? Minus : ArrowRight;
  return (
    <span
      className={"priority " + value}
      title={priorityNames[value] + " приоритет"}
    >
      <Icon size={13} />
    </span>
  );
}
type DraftGuard = { flush: () => Promise<boolean>; dirty: boolean };
type Modal = {
  kind:
    | "board.new"
    | "board.rename"
    | "board.delete"
    | "column.new"
    | "column.rename"
    | "column.delete"
    | "reload";
  id?: string;
};
type Editor = { boardId: string; columnId: string; task: Task; isNew: boolean };
type DropPosition = { columnId: string; beforeId?: string };

function TaskEditor({
  editor,
  board,
  commit,
  onClose,
  onDelete,
  onMove,
  onGuard,
  error,
  onReload,
}: {
  editor: Editor;
  board: Board;
  commit: Commit;
  onClose: () => void;
  onDelete: (id: string) => Promise<void>;
  onMove: (id: string, direction: -1 | 1) => Promise<void>;
  onGuard: (guard: DraftGuard | null) => void;
  error: string;
  onReload: () => void;
}) {
  const initial = { task: editor.task, columnId: editor.columnId };
  const [draft, setDraft] = useState(initial);
  const current = useRef(initial);
  const lastSaved = useRef(editor.isNew ? "" : JSON.stringify(initial));
  const persisted = useRef(!editor.isNew);
  const deleting = useRef(false);
  const [status, setStatus] = useState(
    editor.isNew
      ? "Название — и задача появится на доске"
      : "Все изменения сохранены",
  );
  const [failed, setFailed] = useState(false);
  const [closing, setClosing] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const save = useCallback(
    async (value: typeof initial) => {
      if (deleting.current) return true;
      if (!value.task.title.trim()) {
        if (mounted.current) {
          setStatus("Введите название задачи");
          setFailed(true);
        }
        return false;
      }
      const normalized = {
        task: { ...value.task, title: value.task.title.trim() },
        columnId: value.columnId,
      };
      const serialized = JSON.stringify(normalized);
      if (serialized === lastSaved.current) return true;
      if (mounted.current) {
        setStatus("Сохраняем…");
        setFailed(false);
      }
      const ok = await commit((state) => {
        const existing = state.boards.find((b) => b.id === editor.boardId);
        if (
          persisted.current &&
          (!existing || !findTask(existing, value.task.id))
        ) {
          throw Error(
            "Карточка уже удалена. Черновик не будет создан повторно.",
          );
        }
        return {
          type:
            existing && findTask(existing, value.task.id)
              ? "task.update"
              : "task.add",
          boardId: editor.boardId,
          columnId: normalized.columnId,
          task: normalized.task,
        };
      });
      if (ok) {
        lastSaved.current = serialized;
        persisted.current = true;
      }
      if (mounted.current) {
        setFailed(!ok);
        setStatus(
          ok
            ? JSON.stringify({
                ...current.current,
                task: {
                  ...current.current.task,
                  title: current.current.task.title.trim(),
                },
              }) !== serialized
              ? "Есть изменения, ожидающие сохранения…"
              : storage.desktop
                ? "Все изменения сохранены"
                : "Сохранено только в памяти просмотра"
            : "Не сохранено. Черновик остаётся в панели.",
        );
      }
      return ok;
    },
    [commit, editor.boardId],
  );
  useEffect(() => {
    current.current = draft;
    if (JSON.stringify(draft) !== lastSaved.current && draft.task.title.trim())
      setStatus("Изменения ожидают сохранения…");
    if (!draft.task.title.trim()) return;
    const timer = setTimeout(() => {
      void save(draft);
    }, 700);
    return () => clearTimeout(timer);
  }, [draft, save]);
  useEffect(() => {
    onGuard({
      flush: async () => {
        const value = current.current;
        if (
          !persisted.current &&
          !value.task.title.trim() &&
          !value.task.description.trim() &&
          !value.task.label.trim()
        )
          return true;
        return save(value);
      },
      dirty:
        JSON.stringify(draft) !== lastSaved.current &&
        (persisted.current ||
          !!(
            draft.task.title.trim() ||
            draft.task.description.trim() ||
            draft.task.label.trim()
          )),
    });
    return () => onGuard(null);
  }, [draft, status, save, onGuard]);
  const change = (patch: Partial<Task>) => {
    const next = {
      ...current.current,
      task: { ...current.current.task, ...patch },
    };
    current.current = next;
    setDraft(next);
  };
  const close = async () => {
    setClosing(true);
    const value = current.current;
    if (
      editor.isNew &&
      !value.task.title.trim() &&
      !value.task.description.trim() &&
      !value.task.label.trim() &&
      !findTask(board, value.task.id)
    ) {
      onClose();
      return;
    }
    if (await save(value)) onClose();
    else setClosing(false);
  };
  const found = findTask(board, editor.task.id);
  const position = found ? found.index + 1 : 0;
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) void close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="editor-overlay" />
        <Dialog.Content
          className="editor-panel"
          onInteractOutside={(e) => e.preventDefault()}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement)
              .querySelector<HTMLElement>(
                "input:not([type='hidden']), textarea, select",
              )
              ?.focus();
          }}
        >
          <div className="editor-header">
            <span>{found ? "КАРТОЧКА" : "НОВАЯ ЗАДАЧА"}</span>
            <Dialog.Close asChild>
              <Button
                variant="ghost"
                size="icon"
                disabled={closing}
                aria-label="Закрыть панель"
              >
                <X size={18} />
              </Button>
            </Dialog.Close>
          </div>
          <div className="editor-content">
            <Dialog.Title className="sr-only">
              Редактирование задачи
            </Dialog.Title>
            <Dialog.Description className="editor-help">
              {board.name} <ChevronRight size={12} /> Автосохранение
            </Dialog.Description>
            <label className="field">
              <span>
                Название <small>обязательно</small>
              </span>
              <textarea
                className="task-title-input"
                rows={3}
                maxLength={300}
                placeholder="Что нужно сделать?"
                value={draft.task.title}
                onChange={(e) => change({ title: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Описание</span>
              <textarea
                rows={7}
                maxLength={20000}
                placeholder="Контекст, детали, критерии готовности…"
                value={draft.task.description}
                onChange={(e) => change({ description: e.target.value })}
              />
            </label>
            <div className="editor-properties">
              <label className="field">
                <span>Колонка</span>
                <select
                  value={draft.columnId}
                  onChange={(e) => {
                    const next = {
                      ...current.current,
                      columnId: e.target.value,
                    };
                    current.current = next;
                    setDraft(next);
                  }}
                >
                  {board.columns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Приоритет</span>
                <select
                  value={draft.task.priority}
                  onChange={(e) =>
                    change({ priority: e.target.value as Priority })
                  }
                >
                  {Object.entries(priorityNames).map(([v, name]) => (
                    <option key={v} value={v}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="field">
              <span>Метка</span>
              <input
                maxLength={40}
                value={draft.task.label}
                placeholder="Например, интерфейс"
                onChange={(e) => change({ label: e.target.value })}
              />
            </label>
            <fieldset className="color-picker">
              <legend>Цвет метки</legend>
              {colors.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={
                    "color-choice color-" +
                    c +
                    (draft.task.color === c ? " selected" : "")
                  }
                  title={colorNames[c]}
                  aria-label={colorNames[c]}
                  aria-pressed={draft.task.color === c}
                  onClick={() => change({ color: c })}
                >
                  {draft.task.color === c && <Check size={14} />}
                </button>
              ))}
            </fieldset>
            {found && (
              <div className="task-order">
                <span>
                  Позиция {position} из {found.column.tasks.length}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={position === 1}
                  aria-label="Переместить карточку выше"
                  onClick={async () => {
                    if (await save(current.current))
                      await onMove(editor.task.id, -1);
                  }}
                >
                  <ArrowUp size={15} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={position === found.column.tasks.length}
                  aria-label="Переместить карточку ниже"
                  onClick={async () => {
                    if (await save(current.current))
                      await onMove(editor.task.id, 1);
                  }}
                >
                  <ArrowDown size={15} />
                </Button>
              </div>
            )}
          </div>
          <div className="editor-footer">
            <span
              className={"save-state " + (failed ? "error-text" : "")}
              role="status"
            >
              {failed ? <AlertCircle size={14} /> : <Check size={14} />}{" "}
              {status}
            </span>
            {failed && error && (
              <p className="error-text editor-error" role="alert">
                {error}
              </p>
            )}
            <div>
              {!found && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={status === "Сохраняем…"}
                  onClick={onClose}
                >
                  Отменить создание
                </Button>
              )}
              {found && (
                <Button
                  variant="ghost"
                  className="danger-text"
                  size="sm"
                  onClick={async () => {
                    if (!(await save(current.current))) return;
                    deleting.current = true;
                    await onDelete(editor.task.id);
                    deleting.current = false;
                  }}
                >
                  <Trash2 size={14} />
                  Удалить
                </Button>
              )}
              {failed && (
                <Button variant="ghost" size="sm" onClick={onReload}>
                  Перечитать данные
                </Button>
              )}
              {failed && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void save(current.current)}
                >
                  Повторить
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={closing}
                onClick={() => void close()}
              >
                Готово
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [snapshot, setSnapshot] = useState<Snapshot>({
    workspace: emptyWorkspace(),
    revision: 0,
  });
  const live = useRef(snapshot);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [dataPath, setDataPath] = useState("");
  const [dataDirPath, setDataDirPath] = useState("");
  const [query, setQuery] = useState("");
  const [onlyHigh, setOnlyHigh] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [undo, setUndo] = useState<DeletedTask | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [target, setTarget] = useState("");
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropPosition | null>(null);
  const dragRef = useRef<string | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const [guestBoards, setGuestBoards] = useState<GuestBoard[]>([]);
  const [shareOpen, setShareOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinLink, setJoinLink] = useState("");
  const [joinName, setJoinName] = useState("Вы");
  const [joinError, setJoinError] = useState("");
  const [joinBusy, setJoinBusy] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState("");
  const [themeOpen, setThemeOpen] = useState(false);
  const [activeThemeKey, setActiveThemeKey] = useState(DEFAULT_THEME_ID);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection>("profile");
  const [profile, setProfile] = useState<Profile>(defaultProfile());
  const [shareSettings, setShareSettings] = useState<ShareSettings>({
    ngrokAuthtoken: "",
    staticDomain: "",
  });
  const [hostStatus, setHostStatus] = useState<HostStatus>({
    running: false,
    staticDomain: false,
    participants: [],
  });
  const [collab, setCollab] = useState<CollabState>(initialCollabState);
  const hostingRef = useRef(false);
  const guestOnlineRef = useRef(false);
  const guestIdRef = useRef(createGuestId());
  const clientRef = useRef<CollabClient | null>(null);
  const localBackup = useRef<Snapshot | null>(null);
  const pushWaiter = useRef<{
    resolve: (revision: number) => void;
    reject: (error: Error) => void;
  } | null>(null);
  const guestBoardsRef = useRef(guestBoards);
  guestBoardsRef.current = guestBoards;
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const collabRef = useRef(collab);
  collabRef.current = collab;
  const guard = useRef<DraftGuard | null>(null);
  const [dirty, setDirty] = useState(false);
  const onGuard = useCallback((value: DraftGuard | null) => {
    guard.current = value;
    setDirty(value?.dirty ?? false);
  }, []);
  const commands = useRef<ReturnType<typeof createCommandQueue> | null>(null);
  if (!commands.current)
    commands.current = createCommandQueue({
      get: () => live.current,
      confirmed: (next) => {
        live.current = next;
        setSnapshot(next);
      },
      save: async (workspace, revision) => {
        if (hostingRef.current) return collabApi.hostPush(workspace, revision);
        if (guestOnlineRef.current && clientRef.current) {
          return new Promise<number>((resolve, reject) => {
            pushWaiter.current = { resolve, reject };
            clientRef.current!.push(workspace, revision);
          });
        }
        return storage.saveWorkspace(workspace, revision);
      },
      pending: (delta) => setPending((n) => n + delta),
      error: setError,
    });
  const commit = commands.current.commit;
  useEffect(() => {
    if (!storage.desktop) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    let closing = false;
    const window = getCurrentWindow();
    void window
      .onCloseRequested(async (event) => {
        event.preventDefault();
        if (closing) return;
        closing = true;
        try {
          if (guard.current && !(await guard.current.flush())) return;
          await commands.current!.idle();
          await window.destroy();
        } catch (e) {
          setError(String(e));
        } finally {
          closing = false;
        }
      })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((e) =>
        setError("Не удалось включить защиту закрытия: " + String(e)),
      );
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const value = await storage.loadWorkspace();
      live.current = value;
      setSnapshot(value);
      setLoadFailed(false);
      setError("");
      setEditor(null);
      setUndo(null);
      setDataPath(await storage.location());
      try {
        setDataDirPath(await storage.dataDir());
      } catch {
        setDataDirPath("");
      }
    } catch (e) {
      setError(String(e));
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  const persistGuests = useCallback(async (records: GuestBoard[]) => {
    setGuestBoards(records);
    guestBoardsRef.current = records;
    try {
      await collabApi.saveGuestSessions(records);
    } catch (e) {
      setError(String(e));
    }
  }, []);
  const handleCollabEvent = useCallback(
    (event: CollabEvent) => {
      const next = reduceCollab(collabRef.current, event);
      collabRef.current = next;
      setCollab(next);
      guestOnlineRef.current = next.role === "guest" && next.status === "online";
      if (event.type === "welcome") {
        const invite = next.invite;
        const board =
          event.snapshot.workspace.boards.find(
            (item) => item.id === event.snapshot.workspace.selectedBoardId,
          ) ?? event.snapshot.workspace.boards[0];
        if (invite && board) {
          const applied = applyInvite(guestBoardsRef.current, invite, board);
          void persistGuests(applied.records);
        }
        if (!localBackup.current)
          localBackup.current = structuredClone(live.current);
        live.current = event.snapshot;
        setSnapshot(event.snapshot);
        setJoinBusy(false);
        setJoinOpen(false);
        setToast("Подключено к общей доске");
      }
      if (event.type === "state") {
        live.current = {
          revision: event.revision,
          workspace: event.workspace,
        };
        setSnapshot(live.current);
        pushWaiter.current?.resolve(event.revision);
        pushWaiter.current = null;
      }
      if (event.type === "rejected") {
        live.current = event.snapshot;
        setSnapshot(event.snapshot);
        pushWaiter.current?.reject(Error(event.message));
        pushWaiter.current = null;
      }
      if (event.type === "disconnected") {
        pushWaiter.current?.reject(
          Error(event.error || "Связь с узлом потеряна"),
        );
        pushWaiter.current = null;
        const invite = next.invite;
        if (invite) {
          const records = guestBoardsRef.current.map((record) =>
            record.workspaceId === invite.workspaceId &&
            record.hostId === invite.hostId
              ? { ...record, status: "disconnected" as const }
              : record,
          );
          void persistGuests(records);
        }
      }
      if (event.type === "host_closed") {
        pushWaiter.current?.reject(Error("Хозяин закрыл доступ"));
        pushWaiter.current = null;
      }
    },
    [persistGuests],
  );
  useEffect(() => {
    const client = new CollabClient({ dispatch: handleCollabEvent });
    clientRef.current = client;
    return () => client.disconnect();
  }, [handleCollabEvent]);
  useEffect(() => {
    let cancelled = false;
    void collabApi.loadGuestSessions().then((records) => {
      if (!cancelled) {
        setGuestBoards(records);
        guestBoardsRef.current = records;
      }
    });
    void collabApi.settingsGet().then((settings) => {
      if (!cancelled) setShareSettings(settings);
    });
    void collabApi.hostStatus().then((status) => {
      if (!cancelled) {
        setHostStatus(status);
        hostingRef.current = status.running;
        if (status.running) {
          const next = reduceCollab(collabRef.current, {
            type: "hosting",
            snapshot: live.current,
            workspaceId: status.workspaceId ?? "",
            hostId: status.hostId ?? "",
            staticDomain: status.staticDomain,
          });
          collabRef.current = next;
          setCollab(next);
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    let stop: (() => void) | undefined;
    void collabApi
      .listenHostEvents({
        onState: ({ snapshot, originId }) => {
          if (originId && originId === collabRef.current.hostId) return;
          live.current = snapshot;
          setSnapshot(snapshot);
        },
        onPresence: (participants) => {
          setHostStatus((status) => ({ ...status, participants }));
          setCollab((state) => ({ ...state, participants }));
        },
        onStopped: () => {
          hostingRef.current = false;
          setHostStatus((status) => ({
            ...status,
            running: false,
            inviteLink: null,
            participants: [],
          }));
          setCollab((state) => reduceCollab(state, { type: "stopped" }));
        },
      })
      .then((unlisten) => {
        stop = unlisten;
      });
    return () => stop?.();
  }, []);
  useEffect(() => {
    if (!shouldAutoReconnect(collab) || !collab.invite) return;
    const wait = nextBackoffMs(collab.reconnectAttempt);
    const timer = setTimeout(() => {
      clientRef.current?.connect(
        collab.invite!,
        profileRef.current.displayName,
        guestIdRef.current,
        profileRef.current.color,
      );
    }, wait);
    return () => clearTimeout(timer);
  }, [
    collab.status,
    collab.staticDomain,
    collab.hostClosed,
    collab.reconnectAttempt,
    collab.invite,
  ]);
  useEffect(() => {
    if (collab.role !== "guest" || collab.status !== "online") return;
    const timer = setInterval(() => clientRef.current?.heartbeat(), 15_000);
    return () => clearInterval(timer);
  }, [collab.role, collab.status]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const osName = await storage.defaultDisplayName();
        const prefs = await loadUiPrefs(osName);
        const users = await loadUserThemes();
        const parsed = parseThemeKey(prefs.themeId);
        const record =
          parsed.source === "builtin"
            ? findBuiltin(parsed.id)
            : users.find((item) => item.id === parsed.id);
        const chosen = record ?? findBuiltin(DEFAULT_THEME_ID) ?? BUILTIN_THEMES[0];
        if (!cancelled) {
          applyTheme(chosen.theme);
          setActiveThemeKey(themeRecordKey(chosen));
          setProfile(prefs.profile);
          profileRef.current = prefs.profile;
          setJoinName(prefs.profile.displayName);
        }
        await saveUiPrefs({
          themeId: themeRecordKey(chosen),
          profile: prefs.profile,
        });
      } catch {
        /* keep booted builtin */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    const api = window as Window & {
      __sredaTest?: {
        openShare: () => void;
        openShareActive: () => void;
        openJoin: () => void;
        openClosed: () => void;
        setTheme: (id: string) => void;
        openThemes: () => void;
        openSettings: (section?: SettingsSection) => void;
        setProfile: (next: Profile) => void;
        setHosting: (running: boolean) => void;
        addExample: () => void;
        setShareSettings: (settings: ShareSettings) => void;
        setDataPaths: (dir: string, database: string) => void;
      };
    };
    api.__sredaTest = {
      openShare: () => setShareOpen(true),
      openShareActive: () => {
        setHostStatus({
          running: true,
          publicUrl: "https://sreda.ngrok.app",
          inviteLink:
            "https://sreda.ngrok.app#sreda-invite=eyJmb3JtYXQiOiJzcmVkYS1pbnZpdGUiLCJ2ZXJzaW9uIjoxLCJ3b3Jrc3BhY2VJZCI6IndzX2RlbW8iLCJob3N0SWQiOiJob3N0X2x1Y2FzIiwidXJsIjoiaHR0cHM6Ly9zcmVkYS5uZ3Jvay5hcHAiLCJzdGF0aWNEb21haW4iOnRydWUsInRva2VuIjoiYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhIn0",
          staticDomain: true,
          workspaceId: "ws_demo",
          hostId: "host_lucas",
          participants: [
            {
              id: "host_lucas",
              name: "Лукас",
              selectedBoardId: null,
              role: "host",
              color: "sage",
            },
            {
              id: "guest_anna",
              name: "Анна",
              selectedBoardId: null,
              role: "guest",
              color: "rose",
            },
            {
              id: "guest_mike",
              name: "Михаил",
              selectedBoardId: null,
              role: "guest",
              color: "blue",
            },
          ],
        });
        setShareOpen(true);
      },
      openJoin: () => setJoinOpen(true),
      openClosed: () =>
        setCollab((state) =>
          reduceCollab(state, { type: "host_closed", reason: "closed" }),
        ),
      setTheme: (id: string) => {
        const parsed = parseThemeKey(id);
        const record =
          parsed.source === "builtin"
            ? findBuiltin(parsed.id)
            : undefined;
        if (!record) throw new Error("Unknown theme " + id);
        applyTheme(record.theme);
        setActiveThemeKey(themeRecordKey(record));
      },
      openThemes: () => setThemeOpen(true),
      openSettings: (section) => {
        setSettingsSection(section ?? "profile");
        setSettingsOpen(true);
      },
      setProfile: (next) => {
        setProfile(next);
        profileRef.current = next;
        setJoinName(next.displayName);
      },
      setHosting: (running) => {
        setHostStatus((status) => ({
          ...status,
          running,
          participants: running
            ? [
                {
                  id: "host_local",
                  name: profileRef.current.displayName,
                  selectedBoardId: null,
                  role: "host",
                  color: profileRef.current.color,
                },
              ]
            : [],
        }));
      },
      addExample: () => {
        void commit({ type: "board.add", board: exampleBoard() });
      },
      setShareSettings,
      setDataPaths: (dir, database) => {
        setDataDirPath(dir);
        setDataPath(database);
      },
    };
    return () => {
      delete api.__sredaTest;
    };
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === ",") {
        event.preventDefault();
        setSettingsSection("profile");
        setSettingsOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const openSharePanel = async () => {
    setShareError("");
    try {
      setShareSettings(await collabApi.settingsGet());
      setHostStatus(await collabApi.hostStatus());
    } catch (e) {
      setShareError(String(e));
    }
    setShareOpen(true);
  };
  const startShare = async () => {
    setShareBusy(true);
    setShareError("");
    try {
      await collabApi.settingsSet(shareSettings);
      const started = await collabApi.hostStart();
      const inviteLink = started.inviteLink || (await collabApi.inviteIssue());
      const status = { ...started, inviteLink };
      setHostStatus(status);
      hostingRef.current = true;
      const next = reduceCollab(collabRef.current, {
        type: "hosting",
        snapshot: live.current,
        workspaceId: status.workspaceId ?? "",
        hostId: status.hostId ?? "",
        staticDomain: status.staticDomain,
      });
      collabRef.current = next;
      setCollab(next);
      setToast("Доступ открыт");
    } catch (e) {
      setShareError(String(e));
    } finally {
      setShareBusy(false);
    }
  };
  const stopShare = async () => {
    setShareBusy(true);
    setShareError("");
    try {
      await collabApi.hostStop();
      hostingRef.current = false;
      setHostStatus({ running: false, staticDomain: false, participants: [] });
      const next = reduceCollab(collabRef.current, { type: "stopped" });
      collabRef.current = next;
      setCollab(next);
      setToast("Доступ закрыт");
    } catch (e) {
      setShareError(String(e));
    } finally {
      setShareBusy(false);
    }
  };
  const revokeShare = async () => {
    setShareBusy(true);
    setShareError("");
    try {
      const inviteLink = await collabApi.inviteRevoke();
      setHostStatus((status) => ({ ...status, inviteLink }));
      setToast("Предыдущая ссылка отозвана, выдана новая");
    } catch (e) {
      setShareError(String(e));
    } finally {
      setShareBusy(false);
    }
  };
  const joinByLink = async () => {
    setJoinBusy(true);
    setJoinError("");
    try {
      const invite = parseInviteLink(joinLink);
      clientRef.current?.connect(
        invite,
        joinName.trim(),
        guestIdRef.current,
        profileRef.current.color,
      );
    } catch (e) {
      setJoinError(String(e));
      setJoinBusy(false);
    }
  };
  const restoreLocalWorkspace = () => {
    if (localBackup.current) {
      live.current = localBackup.current;
      setSnapshot(localBackup.current);
      localBackup.current = null;
    }
    guestOnlineRef.current = false;
    clientRef.current?.disconnect();
  };
  const onHostClosedSave = async () => {
    const invite = collab.invite;
    if (!invite) {
      setCollab((state) => reduceCollab(state, { type: "clear_closed" }));
      restoreLocalWorkspace();
      return;
    }
    const result = applyHostClosed(
      guestBoardsRef.current,
      invite,
      collab.snapshot?.workspace ?? live.current.workspace,
      "save-local",
    );
    await persistGuests(result.records);
    const base = localBackup.current ?? live.current;
    const workspace = {
      ...base.workspace,
      boards: [...base.workspace.boards, ...result.localCopies],
      selectedBoardId:
        result.localCopies[0]?.id ?? base.workspace.selectedBoardId,
    };
    try {
      const revision = await storage.saveWorkspace(workspace, base.revision);
      live.current = { revision, workspace };
      setSnapshot(live.current);
    } catch (e) {
      setError(String(e));
    }
    localBackup.current = null;
    guestOnlineRef.current = false;
    clientRef.current?.disconnect();
    const next = reduceCollab(collabRef.current, { type: "stopped" });
    collabRef.current = next;
    setCollab(next);
    setToast("Копия сохранена локально");
  };
  const onHostClosedKeep = async () => {
    const invite = collab.invite;
    if (invite) {
      const result = applyHostClosed(
        guestBoardsRef.current,
        invite,
        collab.snapshot?.workspace ?? null,
        "keep-disconnected",
      );
      await persistGuests(result.records);
    }
    restoreLocalWorkspace();
    const next = reduceCollab(collabRef.current, { type: "clear_closed" });
    next.status = "idle";
    next.role = null;
    collabRef.current = next;
    setCollab(next);
  };
  const workspace = snapshot.workspace;
  const board =
    workspace.boards.find((b) => b.id === workspace.selectedBoardId) ??
    workspace.boards[0];
  const total = board?.columns.reduce((n, c) => n + c.tasks.length, 0) ?? 0;
  const done =
    board?.columns
      .filter((c) => c.kind === "done")
      .reduce((n, c) => n + c.tasks.length, 0) ?? 0;
  const shown =
    board?.columns.map((c) => ({
      ...c,
      tasks: c.tasks.filter(
        (t) =>
          (!onlyHigh || t.priority === "high") &&
          (t.title + " " + t.description + " " + t.label)
            .toLocaleLowerCase("ru")
            .includes(query.toLocaleLowerCase("ru")),
      ),
    })) ?? [];
  const shownTotal = shown.reduce((n, c) => n + c.tasks.length, 0);
  const openModal = (value: Modal) => {
    setModal(value);
    setFormError("");
    setName(
      value.kind === "board.rename"
        ? (board?.name ?? "")
        : value.kind === "column.rename"
          ? (board?.columns.find((c) => c.id === value.id)?.name ?? "")
          : "",
    );
    setDescription(
      value.kind === "board.rename" ? (board?.description ?? "") : "",
    );
    setTarget(board?.columns.find((c) => c.id !== value.id)?.id ?? "");
  };
  const openTask = (columnId: string, task?: Task) => {
    if (!board) return;
    setEditor({
      boardId: board.id,
      columnId,
      task: task
        ? structuredClone(task)
        : {
            id: uid(),
            title: "",
            description: "",
            label: "",
            color: "sage",
            priority: "medium",
          },
      isNew: !task,
    });
  };
  const selectBoard = (id: string) => {
    if (editor) return;
    if (!live.current.workspace.boards.some((b) => b.id === id)) return;
    const next = {
      revision: live.current.revision,
      workspace: { ...live.current.workspace, selectedBoardId: id },
    };
    live.current = next;
    setSnapshot(next);
    setQuery("");
    setOnlyHigh(false);
  };
  const removeTask = async (id: string) => {
    if (!board) return;
    try {
      let deleted: DeletedTask | undefined;
      if (
        await commit((state) => {
          deleted = deletedTask(state, board.id, id);
          return { type: "task.delete", boardId: board.id, id };
        })
      ) {
        setUndo(deleted!);
        setEditor(null);
      }
    } catch (e) {
      setError(String(e));
    }
  };
  const moveRelative = async (id: string, direction: -1 | 1) => {
    if (!board) return;
    await commit((state) => {
      const current = state.boards.find((b) => b.id === board.id);
      const found = current && findTask(current, id);
      if (!found) throw Error("Карточка удалена");
      const i = found.index + direction;
      if (i < 0 || i >= found.column.tasks.length)
        return {
          type: "task.move",
          boardId: board.id,
          id,
          columnId: found.column.id,
          beforeId: id,
        };
      return {
        type: "task.move",
        boardId: board.id,
        id,
        columnId: found.column.id,
        beforeId:
          direction < 0
            ? found.column.tasks[i].id
            : found.column.tasks[i + 1]?.id,
      };
    });
  };
  const importFile = async () => {
    setFileBusy(true);
    try {
      const file = await storage.importBoard();
      if (
        file &&
        (await commit({ type: "board.add", board: importCopy(file) }))
      ) {
        setQuery("");
        setOnlyHigh(false);
        setToast("Доска импортирована как отдельная копия");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setFileBusy(false);
    }
  };
  const exportFile = async () => {
    if (!board) return;
    setFileBusy(true);
    try {
      await commands.current!.idle();
      const current = live.current.workspace.boards.find(
        (b) => b.id === board.id,
      );
      if (!current) throw Error("Доска удалена");
      if (await storage.exportBoard(boardFile(current)))
        setToast("Доска экспортирована");
    } catch (e) {
      setError(String(e));
    } finally {
      setFileBusy(false);
    }
  };
  const openSettings = (section: SettingsSection = "profile") => {
    setSettingsSection(section);
    setSettingsOpen(true);
  };
  const saveProfile = async (next: Profile) => {
    setProfile(next);
    profileRef.current = next;
    setJoinName(next.displayName);
    try {
      await saveUiPrefs({ profile: next });
      await collabApi.hostSetProfile(next.displayName, next.color);
    } catch (e) {
      setError(String(e));
    }
    if (guestOnlineRef.current) {
      clientRef.current?.presence(
        next.displayName,
        live.current.workspace.selectedBoardId,
        next.color,
      );
    }
  };
  const persistShareSettings = async (settings: ShareSettings) => {
    setShareSettings(settings);
    try {
      await collabApi.settingsSet(settings);
    } catch (e) {
      setError(String(e));
    }
  };
  const openDataFolder = async () => {
    const opened = await storage.openDataDir();
    if (!opened) {
      const path = dataDirPath || dataPath;
      if (path) {
        try {
          await navigator.clipboard.writeText(path);
          setToast("Не удалось открыть папку, путь скопирован");
          return;
        } catch {
          /* ignore */
        }
      }
      setToast("Не удалось открыть папку данных");
    }
  };
  const copyDataPath = async () => {
    const path = dataDirPath || dataPath;
    if (!path) return;
    await navigator.clipboard.writeText(path);
    setToast("Путь скопирован");
  };
  const exportBackup = async () => {
    setFileBusy(true);
    try {
      await commands.current!.idle();
      if (await storage.exportWorkspaceBackup(live.current.workspace))
        setToast("Резервная копия сохранена");
    } catch (e) {
      setError(String(e));
    } finally {
      setFileBusy(false);
    }
  };
  const importBackup = async () => {
    setFileBusy(true);
    try {
      const packed = await storage.importBackupOrBoard();
      if (!packed) return;
      if (packed.kind === "board") {
        if (await commit({ type: "board.add", board: importCopy(packed.file) })) {
          setToast("Доска импортирована как отдельная копия");
        }
        return;
      }
      const boards = importBackupBoards(packed.file);
      let added = 0;
      for (const board of boards) {
        if (await commit({ type: "board.add", board })) added += 1;
      }
      if (added)
        setToast(
          added === 1
            ? "Импортирована 1 доска как копия"
            : "Импортировано досок как копии: " + added,
        );
    } catch (e) {
      setError(String(e));
    } finally {
      setFileBusy(false);
    }
  };
  const submitModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modal) return;
    setSubmitting(true);
    setFormError("");
    let ok = false;
    try {
      if (modal.kind === "reload") {
        await commands.current!.idle();
        await load();
        ok = true;
      } else if (modal.kind === "board.new")
        ok = await commit({ type: "board.add", board: newBoard(name) });
      else if (board) {
        switch (modal.kind) {
          case "board.rename":
            ok = await commit({
              type: "board.rename",
              id: board.id,
              name,
              description,
            });
            break;
          case "board.delete":
            ok = await commit({ type: "board.delete", id: board.id });
            if (ok) {
              setUndo(null);
              setQuery("");
            }
            break;
          case "column.new":
            ok = await commit({
              type: "column.add",
              boardId: board.id,
              column: { id: uid(), name: name.trim(), kind: "todo", tasks: [] },
            });
            break;
          case "column.rename":
            ok = await commit({
              type: "column.rename",
              boardId: board.id,
              id: modal.id!,
              name,
            });
            break;
          case "column.delete":
            ok = await commit({
              type: "column.delete",
              boardId: board.id,
              id: modal.id!,
              targetId: target || null,
            });
            break;
        }
      }
      if (ok) setModal(null);
      else
        setFormError(
          "Изменение не сохранено. Подробности — в сообщении об ошибке.",
        );
    } catch (e) {
      setFormError(String(e));
    } finally {
      setSubmitting(false);
    }
  };
  const finishDrop = async (columnId: string, beforeId?: string) => {
    const id = dragRef.current;
    dragRef.current = null;
    setDragging(null);
    setDrop(null);
    if (id && board)
      await commit({
        type: "task.move",
        boardId: board.id,
        id,
        columnId,
        beforeId,
      });
  };
  const columnToDelete = board?.columns.find((c) => c.id === modal?.id);
  const modalTitles = {
    "board.new": "Новая доска",
    "board.rename": "Настройки доски",
    "board.delete": "Удалить доску?",
    "column.new": "Новая колонка",
    "column.rename": "Название колонки",
    "column.delete": "Удалить колонку?",
    reload: "Перечитать данные с диска?",
  };
  return (
    <div className="app-shell" data-sidebar-open={sidebarOpen}>
      <aside id="board-sidebar" className="sidebar" hidden={!sidebarOpen}>
        <div className="brand">
          <div className="brand-symbol">
            <BrandMark size={22} compact />
          </div>
          <span>
            среда<span className="brand-period">.</span>
          </span>
          <span className="local-pill">LOCAL</span>
        </div>
        <div className="workspace">
          <span className="workspace-avatar">Л</span>
          <span>
            Личное пространство<small>Только на этом устройстве</small>
          </span>
        </div>
        <div className="sidebar-divider" />
        <label className="sidebar-search">
          <Search size={15} />
          <input
            aria-label="Поиск задач на доске"
            placeholder="Найти задачу"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              aria-label="Очистить поиск"
              className="plain-icon"
              onClick={() => setQuery("")}
            >
              <X size={12} />
            </button>
          )}
        </label>
        <div className="section-label">
          <span>МОИ ДОСКИ · {workspace.boards.length}</span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Создать доску"
            disabled={loading || loadFailed}
            onClick={() => openModal({ kind: "board.new" })}
          >
            <Plus size={15} />
          </Button>
        </div>
        <nav className="boards-nav" aria-label="Доски">
          {workspace.boards.map((b) => (
            <button
              key={b.id}
              title={b.name}
              className={"board-link " + (board?.id === b.id ? "active" : "")}
              disabled={!!editor}
              onClick={() => selectBoard(b.id)}
            >
              <LayoutGrid size={16} />
              <span>{b.name}</span>
              <span className="nav-count">
                {b.columns.reduce((n, c) => n + c.tasks.length, 0)}
              </span>
            </button>
          ))}
        </nav>
        <button
          className="new-board"
          disabled={loading || loadFailed}
          onClick={() => openModal({ kind: "board.new" })}
        >
          <Plus size={15} />
          Новая доска
        </button>
        <button
          className="new-board"
          disabled={loading || loadFailed || fileBusy}
          onClick={() => void importFile()}
        >
          <Upload size={14} />
          Импортировать доску
        </button>
        <div className="sidebar-bottom">
          <div className="local-note" title={dataPath}>
            <LockKeyhole size={16} />
            <div>
              {storage.desktop ? "Данные на вашем устройстве" : "HTML-просмотр"}
              <small>
                {storage.desktop
                  ? "SQLite · без аккаунта и интернета"
                  : "Без постоянного сохранения"}
              </small>
            </div>
          </div>
          <button
            type="button"
            className="sidebar-footer sidebar-profile"
            onClick={() => openSettings("profile")}
            title="Настройки · профиль"
          >
            <span className={"user-avatar color-" + profile.color}>
              {initials(profile.displayName)}
            </span>
            <div>
              {profile.displayName}
              <small>
                {hostStatus.running ? "Узел открыт" : "Локально"}
              </small>
            </div>
          </button>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="breadcrumbs">
            <Button
              variant="ghost"
              size="icon"
              aria-label={
                sidebarOpen ? "Скрыть боковое меню" : "Показать боковое меню"
              }
              title={
                sidebarOpen ? "Скрыть боковое меню" : "Показать боковое меню"
              }
              aria-expanded={sidebarOpen}
              aria-controls="board-sidebar"
              onClick={() => setSidebarOpen((open) => !open)}
            >
              {sidebarOpen ? (
                <PanelLeftClose size={16} />
              ) : (
                <PanelLeftOpen size={16} />
              )}
            </Button>
            <span className="crumb-separator" />
            <span>Мои доски</span>
            {board && (
              <>
                <ChevronRight size={13} />
                <strong>{board.name}</strong>
              </>
            )}
          </div>
          <div className="topbar-actions">
            {(collab.status === "online" || hostStatus.running) && (
              <span className="online-pill" role="status">
                <span className="online-dot" />
                {collab.role === "guest" ? "Гость онлайн" : "Доступ открыт"}
                {hostStatus.participants.length > 1
                  ? " · " + hostStatus.participants.length
                  : collab.participants.length > 1
                    ? " · " + collab.participants.length
                    : ""}
              </span>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Темы оформления"
              title="Темы оформления"
              onClick={() => setThemeOpen(true)}
            >
              <Palette size={14} />
              Тема
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Настройки"
              title="Настройки (Ctrl+,)"
              onClick={() => openSettings()}
            >
              <SettingsIcon size={15} />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading || loadFailed}
              onClick={() => void openSharePanel()}
            >
              <Share2 size={14} />
              Поделиться
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading || loadFailed}
              onClick={() => {
                setJoinError("");
                setJoinName(profile.displayName);
                setJoinOpen(true);
              }}
            >
              <Link2 size={14} />
              Подключиться по ссылке
            </Button>
          </div>
          <span
            className={"prototype-mark " + (error ? "has-error" : "")}
            role="status"
          >
            {pending ? (
              <LoaderCircle className="spin" size={12} />
            ) : error ? (
              <AlertCircle size={12} />
            ) : (
              <span />
            )}
            {loading
              ? "Открываем…"
              : error
                ? "Проверьте сообщение об ошибке"
                : pending
                  ? "Сохраняем…"
                  : dirty
                    ? "Черновик ожидает сохранения"
                    : storage.desktop
                      ? "Сохранено на устройстве"
                      : "Просмотр · без сохранения"}
          </span>
        </header>
        <ThemePicker
          open={themeOpen}
          onOpenChange={setThemeOpen}
          currentKey={activeThemeKey}
          onSelect={(record) => setActiveThemeKey(themeRecordKey(record))}
        />
        <SettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          section={settingsSection}
          onSectionChange={setSettingsSection}
          profile={profile}
          onSaveProfile={saveProfile}
          themeKey={activeThemeKey}
          onSelectTheme={(record) => setActiveThemeKey(themeRecordKey(record))}
          shareSettings={shareSettings}
          onShareSettings={setShareSettings}
          onPersistShareSettings={persistShareSettings}
          dataPath={dataDirPath || dataPath}
          databasePath={dataPath}
          onOpenDataDir={openDataFolder}
          onCopyPath={copyDataPath}
          onExportBackup={exportBackup}
          onImportBackup={importBackup}
          onOpenNgrokDashboard={async () => {
            await storage.openExternalUrl("https://dashboard.ngrok.com");
          }}
          busy={fileBusy}
        />
        <SharePanel
          open={shareOpen}
          onOpenChange={setShareOpen}
          status={hostStatus}
          settings={shareSettings}
          onSettings={setShareSettings}
          onStart={() => void startShare()}
          onStop={() => void stopShare()}
          onRevoke={() => void revokeShare()}
          busy={shareBusy}
          error={shareError}
        />
        <JoinDialog
          open={joinOpen}
          onOpenChange={setJoinOpen}
          value={joinLink}
          onChange={setJoinLink}
          name={joinName}
          onNameChange={setJoinName}
          onJoin={() => void joinByLink()}
          busy={joinBusy}
          error={joinError}
        />
        <HostClosedDialog
          open={collab.hostClosed}
          boardName={
            collab.snapshot?.workspace.boards.find(
              (item) => item.id === collab.snapshot?.workspace.selectedBoardId,
            )?.name ?? board?.name
          }
          onSaveLocal={() => void onHostClosedSave()}
          onKeep={() => void onHostClosedKeep()}
        />
        {guestBoards
          .filter((record) => record.status === "disconnected")
          .map((record) => (
            <div
              key={record.workspaceId + ":" + record.hostId}
              className="share-banner"
              role="status"
            >
              <AlertCircle size={16} />
              <span>
                Связь с доской «{record.board.name}» потеряна.
                {disconnectedHint(record) ? " " + disconnectedHint(record) : ""}
              </span>
            </div>
          ))}
        {error && (
          <div className="error-banner" role="alert">
            <AlertCircle size={16} />
            <span>{error}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={pending > 0}
              onClick={() =>
                loadFailed ? void load() : openModal({ kind: "reload" })
              }
            >
              {loadFailed ? "Повторить загрузку" : "Перечитать с диска"}
            </Button>
          </div>
        )}
        {loading ? (
          <div className="empty-screen">
            <LoaderCircle size={24} className="spin" />
            <h1>Открываем рабочее пространство</h1>
          </div>
        ) : loadFailed ? (
          <div className="empty-screen">
            <AlertCircle size={30} />
            <h1>Не удалось открыть данные</h1>
            <p>
              Данные не заменялись. Проверьте сообщение об ошибке и повторите
              загрузку.
            </p>
          </div>
        ) : !board ? (
          <div className="empty-screen">
            <div
              className="empty-illustration"
              aria-hidden
              dangerouslySetInnerHTML={{ __html: firstRunSvg }}
            />
            <span className="board-eyebrow">ВАШЕ ЛИЧНОЕ РАБОЧЕЕ МЕСТО</span>
            <h1>Освободите место для главного.</h1>
            <p>
              Создайте первую доску. Задачи, порядок и изменения
              <br />
              будут сохраняться на этом устройстве автоматически.
            </p>
            <div>
              <Button onClick={() => openModal({ kind: "board.new" })}>
                <Plus size={16} />
                Создать доску
              </Button>
              <Button
                variant="outline"
                onClick={async () => {
                  if (
                    await commit({ type: "board.add", board: exampleBoard() })
                  )
                    setToast("Добавлена учебная доска с примерами");
                }}
              >
                Посмотреть на примере
              </Button>
            </div>
            <small>
              Пример добавляется только по вашему выбору. Его можно удалить.
            </small>
          </div>
        ) : (
          <>
            <section className="board-heading">
              <div className="heading-top">
                <div className="board-eyebrow">
                  <span className="board-logo">
                    <BrandMark size={16} compact />
                  </span>
                  РАБОЧАЯ ДОСКА
                </div>
                <ActionMenu
                  label="Меню доски"
                  trigger={<MoreHorizontal size={19} />}
                >
                  <button onClick={() => openModal({ kind: "board.rename" })}>
                    <Pencil size={14} />
                    Название и описание
                  </button>
                  <button disabled={fileBusy} onClick={() => void exportFile()}>
                    <Download size={14} />
                    Экспортировать JSON
                  </button>
                  <button disabled={fileBusy} onClick={() => void importFile()}>
                    <Upload size={14} />
                    Импортировать доску
                  </button>
                  <hr />
                  <button
                    className="danger-text"
                    onClick={() => openModal({ kind: "board.delete" })}
                  >
                    <Trash2 size={14} />
                    Удалить доску
                  </button>
                </ActionMenu>
              </div>
              <div className="heading-row">
                <div>
                  <h1>{board.name}</h1>
                  <p>
                    {board.description ||
                      "Ваши задачи, решения и следующие шаги. По одной задаче за раз."}
                  </p>
                </div>
                <Button onClick={() => openTask(board.columns[0].id)}>
                  <Plus size={16} />
                  Новая задача
                </Button>
              </div>
              <div className="board-meta">
                <span>
                  <LockKeyhole size={12} />
                  Личная доска
                </span>
                <span className="meta-dot">·</span>
                <span>{total} задач</span>
                <span className="meta-dot">·</span>
                <span>Автосохранение</span>
                <div className="progress-overview">
                  <span>
                    {done} из {total} в «Готово»
                  </span>
                  <div>
                    <i
                      style={{
                        width: `${total ? Math.round((done / total) * 100) : 0}%`,
                      }}
                    />
                  </div>
                  <strong>
                    {total ? Math.round((done / total) * 100) : 0}%
                  </strong>
                </div>
              </div>
            </section>
            <div className="board-toolbar">
              <div className="view-tab">
                <LayoutGrid size={15} />
                Доска
              </div>
              <div className="toolbar-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  className={onlyHigh ? "filter-active" : ""}
                  onClick={() => setOnlyHigh(!onlyHigh)}
                >
                  <SlidersHorizontal size={14} />
                  {onlyHigh ? "Высокий приоритет" : "Фильтр"}
                  {onlyHigh && <span className="filter-dot" />}
                </Button>
                <span className="toolbar-divider" />
                <span className="task-total">
                  {shownTotal} из {total} задач
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={board.columns.length >= 50}
                  onClick={() => openModal({ kind: "column.new" })}
                >
                  <Plus size={14} />
                  Колонка
                </Button>
              </div>
            </div>
            <div className="board-canvas">
              <div
                className="columns live-columns"
                style={{
                  gridTemplateColumns: `repeat(${board.columns.length}, minmax(250px, 1fr))`,
                }}
              >
                {shown.map((col, colIndex) => (
                  <section className={"column " + col.kind} key={col.id}>
                    <div className="column-heading">
                      <span className="status-icon">
                        {col.kind === "done" ? (
                          <CheckCheck size={16} />
                        ) : col.kind === "progress" ? (
                          <CircleDot size={16} />
                        ) : (
                          <CircleDashed size={16} />
                        )}
                      </span>
                      <h2 title={col.name}>{col.name}</h2>
                      <span className="column-count">
                        {board.columns[colIndex].tasks.length}
                      </span>
                      <div className="column-actions">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={"Добавить в " + col.name}
                          onClick={() => openTask(col.id)}
                        >
                          <Plus size={15} />
                        </Button>
                        <ActionMenu
                          className="column-menu"
                          label={"Настройки колонки " + col.name}
                          trigger={<MoreHorizontal size={15} />}
                        >
                          <button
                            onClick={() =>
                              openModal({ kind: "column.rename", id: col.id })
                            }
                          >
                            <Pencil size={14} />
                            Переименовать
                          </button>
                          <div
                            className="menu-kind"
                            role="group"
                            aria-label="Тип колонки"
                          >
                            <span>Тип колонки</span>
                            {columnKinds.map((kind) => (
                              <button
                                key={kind}
                                type="button"
                                className={col.kind === kind ? "selected" : ""}
                                aria-pressed={col.kind === kind}
                                onClick={() =>
                                  void commit({
                                    type: "column.setKind",
                                    boardId: board.id,
                                    id: col.id,
                                    kind,
                                  })
                                }
                              >
                                {columnKindNames[kind]}
                              </button>
                            ))}
                          </div>
                          <button
                            disabled={colIndex === 0}
                            onClick={() =>
                              void commit({
                                type: "column.move",
                                boardId: board.id,
                                id: col.id,
                                direction: -1,
                              })
                            }
                          >
                            <ArrowLeft size={14} />
                            Переместить влево
                          </button>
                          <button
                            disabled={colIndex === board.columns.length - 1}
                            onClick={() =>
                              void commit({
                                type: "column.move",
                                boardId: board.id,
                                id: col.id,
                                direction: 1,
                              })
                            }
                          >
                            <ArrowRight size={14} />
                            Переместить вправо
                          </button>
                          <hr />
                          <button
                            className="danger-text"
                            disabled={board.columns.length === 1}
                            onClick={() =>
                              openModal({ kind: "column.delete", id: col.id })
                            }
                          >
                            <Trash2 size={14} />
                            Удалить колонку
                          </button>
                        </ActionMenu>
                      </div>
                    </div>
                    <p className="column-hint">
                      {col.kind === "done"
                        ? "Уже можно опираться"
                        : col.kind === "progress"
                          ? "Фокус на главном"
                          : "Следующее в работе"}
                    </p>
                    <div
                      className={
                        "cards drop-zone " +
                        (dragging ? "is-dragging" : "") +
                        (drop?.columnId === col.id && !drop.beforeId
                          ? " drop-at-end"
                          : "")
                      }
                      onDragOver={(e) => {
                        if (!dragRef.current) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        setDrop({ columnId: col.id });
                      }}
                      onDrop={(e) => {
                        if (!dragRef.current) return;
                        e.preventDefault();
                        void finishDrop(col.id);
                      }}
                    >
                      {col.tasks.map((task) => (
                        <button
                          key={task.id}
                          draggable
                          className={
                            "task-card " +
                            (col.kind === "done" ? "completed " : "") +
                            (task.priority === "high" && col.kind === "progress"
                              ? "featured "
                              : "") +
                            (dragging === task.id ? "drag-source " : "") +
                            (drop?.columnId === col.id &&
                            drop.beforeId === task.id
                              ? "drop-before"
                              : "")
                          }
                          onClick={() => {
                            if (!dragRef.current) openTask(col.id, task);
                          }}
                          onDragStart={(e) => {
                            dragRef.current = task.id;
                            setDragging(task.id);
                            e.dataTransfer.effectAllowed = "move";
                            e.dataTransfer.setData(
                              "application/x-sreda-task",
                              task.id,
                            );
                            e.dataTransfer.setData("text/plain", task.title);
                          }}
                          onDragEnd={() => {
                            dragRef.current = null;
                            setDragging(null);
                            setDrop(null);
                          }}
                          onDragOver={(e) => {
                            if (!dragRef.current) return;
                            e.preventDefault();
                            e.stopPropagation();
                            const rect =
                              e.currentTarget.getBoundingClientRect();
                            const original = board.columns[colIndex].tasks;
                            const beforeId =
                              e.clientY < rect.top + rect.height / 2
                                ? task.id
                                : original[
                                    original.findIndex(
                                      (t) => t.id === task.id,
                                    ) + 1
                                  ]?.id;
                            setDrop({ columnId: col.id, beforeId });
                          }}
                          onDrop={(e) => {
                            if (!dragRef.current) return;
                            e.preventDefault();
                            e.stopPropagation();
                            const rect =
                              e.currentTarget.getBoundingClientRect();
                            const original = board.columns[colIndex].tasks;
                            void finishDrop(
                              col.id,
                              e.clientY < rect.top + rect.height / 2
                                ? task.id
                                : original[
                                    original.findIndex(
                                      (t) => t.id === task.id,
                                    ) + 1
                                  ]?.id,
                            );
                          }}
                        >
                          <div className="card-top">
                            {task.label ? (
                              <span className={"tag color-" + task.color}>
                                {task.label}
                              </span>
                            ) : (
                              <span className="no-label">Задача</span>
                            )}
                            <span className="card-id">
                              <GripVertical size={12} />
                            </span>
                          </div>
                          <h3>{task.title}</h3>
                          {task.description && (
                            <p className="task-description">
                              {task.description}
                            </p>
                          )}
                          <div className="card-footer">
                            <div className="card-details">
                              <PriorityIcon value={task.priority} />
                              <span>{priorityNames[task.priority]}</span>
                            </div>
                            {col.kind === "done" ? (
                              <Check size={13} className="done-check" />
                            ) : (
                              <span className="card-open">
                                <Pencil size={12} />
                              </span>
                            )}
                          </div>
                        </button>
                      ))}
                      {!col.tasks.length && (
                        <div className="column-empty">
                          {query || onlyHigh
                            ? "Нет подходящих задач"
                            : "Пока без задач"}
                          <small>
                            {query || onlyHigh
                              ? "Измените поиск или фильтр"
                              : "Добавьте первую или перетащите сюда"}
                          </small>
                        </div>
                      )}
                    </div>
                    <button
                      className="add-task"
                      onClick={() => openTask(col.id)}
                    >
                      <Plus size={15} />
                      Добавить задачу
                    </button>
                  </section>
                ))}
              </div>
              <div className="canvas-footer">
                <span>
                  <span className="quiet-dot" />
                  {storage.desktop
                    ? "SQLite · изменения сохраняются автоматически"
                    : "HTML-просмотр · без постоянного сохранения"}
                </span>
                <span>Перетащите карточку или откройте для редактирования</span>
              </div>
            </div>
          </>
        )}
      </main>
      {editor && workspace.boards.some((b) => b.id === editor.boardId) && (
        <TaskEditor
          key={editor.task.id}
          editor={editor}
          board={workspace.boards.find((b) => b.id === editor.boardId)!}
          commit={commit}
          onGuard={onGuard}
          error={error}
          onReload={() => openModal({ kind: "reload" })}
          onClose={() => setEditor(null)}
          onDelete={removeTask}
          onMove={moveRelative}
        />
      )}
      <Dialog.Root
        open={!!modal}
        onOpenChange={(open) => {
          if (!open && !submitting) setModal(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content
            className="info-dialog edit-dialog"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              (event.currentTarget as HTMLElement)
                .querySelector<HTMLElement>(
                  "input:not([type='hidden']), textarea, select",
                )
                ?.focus();
            }}
          >
            <div className="modal-heading">
              <Dialog.Title>{modal && modalTitles[modal.kind]}</Dialog.Title>
              <Dialog.Close asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={submitting}
                  aria-label="Закрыть"
                >
                  <X size={17} />
                </Button>
              </Dialog.Close>
            </div>
            <Dialog.Description>
              {modal?.kind === "board.delete"
                ? "Доска и все её задачи будут удалены. Это действие нельзя отменить. При необходимости сначала экспортируйте доску."
                : modal?.kind === "column.delete"
                  ? columnToDelete?.tasks.length
                    ? `В колонке ${columnToDelete.tasks.length} задач. Выберите, куда их перенести. Порядок задач сохранится, они добавятся в конец выбранной колонки.`
                    : "Колонка пуста. Её можно удалить."
                  : modal?.kind === "reload"
                    ? "Несохранённый черновик будет закрыт. Подтверждённые SQLite изменения останутся. После загрузки повторите действие."
                    : "Изменения сохраняются автоматически на этом устройстве."}
            </Dialog.Description>
            <form onSubmit={(e) => void submitModal(e)}>
              {modal &&
                !["board.delete", "column.delete", "reload"].includes(
                  modal.kind,
                ) && (
                  <label className="field">
                    <span className="field-label">
                      <span>Название</span>
                      <span className="field-tag is-required">обязательно</span>
                    </span>
                    <input
                      required
                      maxLength={modal.kind.startsWith("column") ? 80 : 120}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={
                        modal.kind.startsWith("column")
                          ? "На проверке"
                          : "Работа"
                      }
                    />
                  </label>
                )}
              {modal?.kind === "board.rename" && (
                <label className="field">
                  <span className="field-label">
                    <span>Описание доски</span>
                    <span className="field-tag">необязательно</span>
                  </span>
                  <textarea
                    rows={3}
                    maxLength={2000}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Коротко, о чём эта доска"
                  />
                </label>
              )}
              {modal?.kind === "column.delete" &&
                !!columnToDelete?.tasks.length && (
                  <label className="field">
                    <span className="field-label">
                      <span>Перенести задачи в</span>
                      <span className="field-tag is-required">обязательно</span>
                    </span>
                    <select
                      required
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                    >
                      {board?.columns
                        .filter((c) => c.id !== modal.id)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
              {formError && (
                <p role="alert" className="error-text">
                  {formError}
                </p>
              )}
              <div className="modal-buttons">
                <Dialog.Close asChild>
                  <Button type="button" variant="ghost" disabled={submitting}>
                    Отмена
                  </Button>
                </Dialog.Close>
                <Button
                  type="submit"
                  disabled={
                    submitting ||
                    (!name.trim() &&
                      !!modal &&
                      !["board.delete", "column.delete", "reload"].includes(
                        modal.kind,
                      ))
                  }
                  className={
                    modal?.kind.endsWith("delete") ? "button-danger" : ""
                  }
                >
                  {submitting
                    ? "Сохраняем…"
                    : modal?.kind.endsWith("delete")
                      ? "Удалить"
                      : modal?.kind === "reload"
                        ? "Перечитать"
                        : "Сохранить"}
                </Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      {undo && (
        <div className="undo-toast" role="status">
          <Trash2 size={15} />
          <span>Удалена «{undo.task.title}»</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              if (await commit({ type: "task.restore", deleted: undo })) {
                setUndo(null);
                setToast("Карточка восстановлена");
              }
            }}
          >
            <Undo2 size={14} />
            Отменить
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Скрыть отмену удаления"
            onClick={() => setUndo(null)}
          >
            <X size={14} />
          </Button>
        </div>
      )}
      {toast && (
        <div className="success-toast" role="status">
          <Check size={15} />
          {toast}
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
