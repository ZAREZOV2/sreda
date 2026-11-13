import { isRecurrence, nextOccurrence, type Recurrence } from "./recurrence.ts";

export type { Recurrence };
export type Priority = "high" | "medium" | "low";
export type Color = "sage" | "blue" | "amber" | "rose" | "violet" | "gray";
export type Task = {
  id: string;
  title: string;
  description: string;
  label: string;
  color: Color;
  priority: Priority;
  timeSpentMs?: number;
  recurrence?: Recurrence;
  reminderAt?: number | null;
  linkedDocId?: string | null;
};
export type ColumnKind = "todo" | "progress" | "done";
export type Column = {
  id: string;
  name: string;
  kind: ColumnKind;
  tasks: Task[];
};
export const columnKinds: ColumnKind[] = ["todo", "progress", "done"];
export const columnKindNames: Record<ColumnKind, string> = {
  todo: "Нужно сделать",
  progress: "В работе",
  done: "Готово",
};
export function inferColumnKind(
  name: string,
  index: number,
  total: number,
): ColumnKind {
  const normalized = name.trim().toLocaleLowerCase("ru");
  if (normalized === "готово") return "done";
  if (normalized === "в работе") return "progress";
  if (normalized === "нужно сделать") return "todo";
  if (total === 3) return columnKinds[index] ?? "todo";
  return "todo";
}
export type Board = {
  id: string;
  name: string;
  description: string;
  columns: Column[];
};
export type Workspace = {
  schemaVersion: 1;
  boards: Board[];
  selectedBoardId: string | null;
};
export type Snapshot = { revision: number; workspace: Workspace };
export type BoardFile = { format: "sreda-board"; version: 1; board: Board };
export type BackupDocument = {
  id: string;
  title: string;
  markdown: string;
  revision: number;
  folderId?: string | null;
  linkedCardId?: string | null;
};
export type BackupFolder = {
  id: string;
  name: string;
  parentId?: string | null;
  revision: number;
};
export type WorkspaceBackup = {
  format: "sreda-backup";
  version: 1 | 2;
  workspace: Workspace;
  documents?: BackupDocument[];
  folders?: BackupFolder[];
};
export type DeletedTask = {
  boardId: string;
  columnId: string;
  index: number;
  task: Task;
};
export const colors: Color[] = [
  "sage",
  "blue",
  "amber",
  "rose",
  "violet",
  "gray",
];
export const uid = () => crypto.randomUUID();
export const emptyWorkspace = (): Workspace => ({
  schemaVersion: 1,
  boards: [],
  selectedBoardId: null,
});
export function newBoard(name: string): Board {
  return {
    id: uid(),
    name: name.trim(),
    description: "",
    columns: [
      { id: uid(), name: "Нужно сделать", kind: "todo", tasks: [] },
      { id: uid(), name: "В работе", kind: "progress", tasks: [] },
      { id: uid(), name: "Готово", kind: "done", tasks: [] },
    ],
  };
}
export type Action =
  | { type: "board.add"; board: Board }
  | { type: "board.select"; id: string }
  | { type: "board.rename"; id: string; name: string; description: string }
  | { type: "board.delete"; id: string }
  | { type: "column.add"; boardId: string; column: Column }
  | { type: "column.rename"; boardId: string; id: string; name: string }
  | { type: "column.setKind"; boardId: string; id: string; kind: ColumnKind }
  | { type: "column.move"; boardId: string; id: string; direction: -1 | 1 }
  | {
      type: "column.delete";
      boardId: string;
      id: string;
      targetId: string | null;
    }
  | { type: "task.add"; boardId: string; columnId: string; task: Task }
  | { type: "task.update"; boardId: string; columnId: string; task: Task }
  | {
      type: "task.move";
      boardId: string;
      id: string;
      columnId: string;
      beforeId?: string;
    }
  | { type: "task.delete"; boardId: string; id: string }
  | { type: "task.restore"; deleted: DeletedTask };
function required<T>(
  value: T | undefined,
  message = "Объект уже удалён. Обновите данные.",
): T {
  if (value === undefined) throw Error(message);
  return value;
}
export function findTask(board: Board, id: string) {
  for (const column of board.columns) {
    const index = column.tasks.findIndex((t) => t.id === id);
    if (index !== -1) return { column, index, task: column.tasks[index] };
  }
  return undefined;
}
export function deletedTask(
  workspace: Workspace,
  boardId: string,
  id: string,
): DeletedTask {
  const board = required(workspace.boards.find((b) => b.id === boardId));
  const found = required(findTask(board, id));
  return {
    boardId,
    columnId: found.column.id,
    index: found.index,
    task: structuredClone(found.task),
  };
}
export function applyAction(previous: Workspace, action: Action): Workspace {
  const state = structuredClone(previous);
  if (action.type === "board.add") {
    state.boards.push(structuredClone(action.board));
    state.selectedBoardId = action.board.id;
  } else if (action.type === "board.select") {
    required(state.boards.find((b) => b.id === action.id));
    state.selectedBoardId = action.id;
  } else if (action.type === "board.delete") {
    const index = state.boards.findIndex((b) => b.id === action.id);
    if (index === -1) throw Error("Доска уже удалена");
    state.boards.splice(index, 1);
    if (state.selectedBoardId === action.id)
      state.selectedBoardId =
        state.boards[Math.min(index, state.boards.length - 1)]?.id ?? null;
  } else if (action.type === "board.rename") {
    const b = required(state.boards.find((b) => b.id === action.id));
    b.name = action.name.trim();
    b.description = action.description.trim();
  } else {
    const boardId =
      action.type === "task.restore" ? action.deleted.boardId : action.boardId;
    const board = required(
      state.boards.find((b) => b.id === boardId),
      "Доска удалена — действие невозможно.",
    );
    switch (action.type) {
      case "column.add":
        board.columns.push(structuredClone(action.column));
        break;
      case "column.rename":
        required(board.columns.find((c) => c.id === action.id)).name =
          action.name.trim();
        break;
      case "column.setKind":
        required(board.columns.find((c) => c.id === action.id)).kind =
          action.kind;
        break;
      case "column.move": {
        const from = board.columns.findIndex((c) => c.id === action.id);
        if (from === -1) throw Error("Колонка удалена");
        const to = from + action.direction;
        if (to >= 0 && to < board.columns.length) {
          const [column] = board.columns.splice(from, 1);
          board.columns.splice(to, 0, column);
        }
        break;
      }
      case "column.delete": {
        if (board.columns.length === 1)
          throw Error("На доске должна остаться хотя бы одна колонка");
        const column = required(board.columns.find((c) => c.id === action.id));
        if (column.tasks.length) {
          const target = required(
            board.columns.find(
              (c) => c.id === action.targetId && c.id !== column.id,
            ),
            "Выберите колонку для переноса задач",
          );
          target.tasks.push(...column.tasks);
        }
        board.columns = board.columns.filter((c) => c.id !== action.id);
        break;
      }
      case "task.add":
        required(
          board.columns.find((c) => c.id === action.columnId),
        ).tasks.push(structuredClone(action.task));
        break;
      case "task.update": {
        const found = required(findTask(board, action.task.id));
        const fromKind = found.column.kind;
        const target = required(
          board.columns.find((c) => c.id === action.columnId),
        );
        const task = structuredClone(action.task);
        if (target.id === found.column.id)
          found.column.tasks[found.index] = task;
        else {
          found.column.tasks.splice(found.index, 1);
          target.tasks.push(task);
        }
        if (target.kind === "done" && fromKind !== "done")
          spawnRecurringTask(board, task);
        break;
      }
      case "task.move": {
        if (action.beforeId === action.id) break;
        const found = required(findTask(board, action.id));
        const fromKind = found.column.kind;
        const target = required(
          board.columns.find((c) => c.id === action.columnId),
        );
        found.column.tasks.splice(found.index, 1);
        const to =
          action.beforeId === undefined
            ? target.tasks.length
            : target.tasks.findIndex((t) => t.id === action.beforeId);
        if (to < 0) throw Error("Позиция переноса больше не существует");
        target.tasks.splice(to, 0, found.task);
        if (target.kind === "done" && fromKind !== "done")
          spawnRecurringTask(board, found.task);
        break;
      }
      case "task.delete": {
        const found = required(findTask(board, action.id));
        found.column.tasks.splice(found.index, 1);
        break;
      }
      case "task.restore": {
        const item = action.deleted;
        if (findTask(board, item.task.id))
          throw Error("Карточка уже восстановлена");
        required(
          board.columns.find((c) => c.id === item.columnId),
          "Исходная колонка удалена. Отмена недоступна.",
        ).tasks.splice(
          Math.min(
            item.index,
            required(board.columns.find((c) => c.id === item.columnId)).tasks
              .length,
          ),
          0,
          structuredClone(item.task),
        );
        break;
      }
    }
  }
  validateWorkspace(state);
  return state;
}
function spawnRecurringTask(board: Board, completed: Task) {
  if (!isRecurrence(completed.recurrence)) return;
  const recurrence = completed.recurrence;
  const next: Task = {
    ...structuredClone(completed),
    id: uid(),
    timeSpentMs: undefined,
    reminderAt: nextOccurrence(completed.reminderAt ?? Date.now(), recurrence),
  };
  delete completed.recurrence;
  const todo =
    board.columns.find((column) => column.kind === "todo") ?? board.columns[0];
  todo.tasks.unshift(next);
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Ожидался объект данных");
  return value as Record<string, unknown>;
}
function keys(
  o: Record<string, unknown>,
  expected: string[],
  optional: string[] = [],
) {
  const allowed = new Set([...expected, ...optional]);
  if (
    Object.keys(o).some((k) => !allowed.has(k)) ||
    expected.some((k) => !(k in o))
  )
    throw Error("Неверный набор полей файла");
}
function text(
  value: unknown,
  max: number,
  required = false,
): asserts value is string {
  if (
    typeof value !== "string" ||
    [...value].length > max ||
    (required && !value.trim()) ||
    value.includes("\0")
  )
    throw Error("Некорректный текст или превышена допустимая длина");
}
export function validateBoard(
  value: unknown,
  ids = new Set<string>(),
  counter = { tasks: 0 },
): asserts value is Board {
  const id = (v: unknown) => {
    text(v, 100, true);
    if (!/^[a-zA-Z0-9_-]+$/.test(v) || ids.has(v))
      throw Error("Идентификаторы должны быть уникальны");
    ids.add(v);
  };
  const b = object(value);
  keys(b, ["id", "name", "description", "columns"]);
  id(b.id);
  text(b.name, 120, true);
  text(b.description, 2000);
  const columns = b.columns;
  if (!Array.isArray(columns) || columns.length < 1 || columns.length > 50)
    throw Error("На доске должно быть от 1 до 50 колонок");
  columns.forEach((item, index) => {
    const c = object(item);
    keys(c, ["id", "name", "tasks"], ["kind"]);
    id(c.id);
    text(c.name, 80, true);
    if (c.kind !== undefined && !columnKinds.includes(c.kind as ColumnKind))
      throw Error("Некорректный тип колонки");
    if (c.kind === undefined)
      c.kind = inferColumnKind(c.name, index, columns.length);
    if (!Array.isArray(c.tasks)) throw Error("Неверный список задач");
    for (const item of c.tasks) {
      if (++counter.tasks > 10000)
        throw Error("Превышен предел 10 000 карточек");
      const t = object(item);
      keys(
        t,
        ["id", "title", "description", "label", "color", "priority"],
        ["timeSpentMs", "recurrence", "reminderAt", "linkedDocId"],
      );
      id(t.id);
      text(t.title, 300, true);
      text(t.description, 20000);
      text(t.label, 40);
      if (
        !colors.includes(t.color as Color) ||
        !["high", "medium", "low"].includes(t.priority as string)
      )
        throw Error("Неверная метка или приоритет");
      if (t.timeSpentMs !== undefined) {
        if (
          typeof t.timeSpentMs !== "number" ||
          !Number.isSafeInteger(t.timeSpentMs) ||
          t.timeSpentMs < 0 ||
          t.timeSpentMs > 10 * 365 * 24 * 60 * 60 * 1000
        )
          throw Error("Некорректный учёт времени");
      }
      if (t.recurrence !== undefined && t.recurrence !== null && !isRecurrence(t.recurrence))
        throw Error("Некорректное повторение задачи");
      if (
        t.reminderAt !== undefined &&
        t.reminderAt !== null &&
        (typeof t.reminderAt !== "number" || !Number.isFinite(t.reminderAt))
      )
        throw Error("Некорректное напоминание");
      if (t.linkedDocId !== undefined && t.linkedDocId !== null) {
        text(t.linkedDocId, 100, true);
        if (!/^[a-zA-Z0-9_-]+$/.test(t.linkedDocId as string))
          throw Error("Некорректная связь с документом");
      }
    }
  });
}
export function validateWorkspace(value: unknown): asserts value is Workspace {
  const w = object(value);
  keys(w, ["schemaVersion", "boards", "selectedBoardId"]);
  if (
    w.schemaVersion !== 1 ||
    !Array.isArray(w.boards) ||
    w.boards.length > 100
  )
    throw Error("Неподдерживаемые данные");
  const ids = new Set<string>(),
    count = { tasks: 0 };
  for (const b of w.boards) validateBoard(b, ids, count);
  if (
    w.selectedBoardId !== null &&
    !w.boards.some((b) => b.id === w.selectedBoardId)
  )
    throw Error("Выбранная доска отсутствует");
}
export function parseBoardFile(value: unknown): BoardFile {
  const file = object(value);
  keys(file, ["format", "version", "board"]);
  if (file.format !== "sreda-board" || file.version !== 1)
    throw Error("Ожидался файл доски Среда версии 1");
  validateBoard(file.board);
  return file as BoardFile;
}
export function boardFile(board: Board): BoardFile {
  return { format: "sreda-board", version: 1, board: structuredClone(board) };
}
export function importCopy(file: BoardFile): Board {
  parseBoardFile(file);
  const board = structuredClone(file.board);
  board.id = uid();
  for (const c of board.columns) {
    c.id = uid();
    for (const t of c.tasks) t.id = uid();
  }
  return board;
}
export function exampleBoard(): Board {
  const b = newBoard("Пример · Разработка приложения");
  b.description =
    "Учебная доска с примерами. Эти задачи можно свободно изменить или удалить.";
  const entries: [string, string, string, Color, Priority, number][] = [
    [
      "Продумать первый запуск",
      "Пустая доска, подсказки и создание первой задачи.",
      "Интерфейс",
      "sage",
      "high",
      0,
    ],
    [
      "Добавить горячие клавиши",
      "Быстрое создание задачи и переход к поиску.",
      "Удобство",
      "amber",
      "medium",
      0,
    ],
    [
      "Схема локальных данных",
      "Доски, колонки и стабильные идентификаторы.",
      "Разработка",
      "blue",
      "medium",
      0,
    ],
    ["Проверить состояния фокуса", "", "Интерфейс", "sage", "low", 0],
    [
      "Собрать основной экран доски",
      "Найти баланс между плотностью и спокойным интерфейсом.",
      "Интерфейс",
      "sage",
      "high",
      1,
    ],
    [
      "Настроить оболочку Tauri",
      "Размер окна и сборка под Windows.",
      "Разработка",
      "blue",
      "medium",
      1,
    ],
    ["Подобрать набор иконок", "", "Интерфейс", "sage", "low", 1],
    [
      "Определить сценарий локальной работы",
      "Одна доска, понятные статусы, всё под рукой.",
      "Планирование",
      "gray",
      "medium",
      2,
    ],
    [
      "Выбрать технологический стек",
      "Rust · Tauri · React · SQLite",
      "Разработка",
      "blue",
      "medium",
      2,
    ],
    ["Зафиксировать визуальное направление", "", "Интерфейс", "sage", "low", 2],
  ];
  for (const [title, description, label, color, priority, column] of entries)
    b.columns[column].tasks.push({
      id: uid(),
      title,
      description,
      label,
      color,
      priority,
    });
  return b;
}

function validateBackupDocument(value: unknown): asserts value is BackupDocument {
  const doc = object(value);
  keys(
    doc,
    ["id", "title", "markdown", "revision"],
    ["folderId", "linkedCardId"],
  );
  text(doc.id, 100, true);
  if (!/^[a-zA-Z0-9_-]+$/.test(doc.id as string))
    throw Error("Некорректный идентификатор документа");
  text(doc.title, 200, true);
  text(doc.markdown, 2 * 1024 * 1024);
  if (
    typeof doc.revision !== "number" ||
    !Number.isSafeInteger(doc.revision) ||
    doc.revision < 0
  )
    throw Error("Некорректная версия документа");
  if (doc.folderId != null) text(doc.folderId, 100, true);
  if (doc.linkedCardId != null) text(doc.linkedCardId, 100, true);
}

function validateBackupFolder(value: unknown): asserts value is BackupFolder {
  const folder = object(value);
  keys(folder, ["id", "name", "revision"], ["parentId"]);
  text(folder.id, 100, true);
  text(folder.name, 80, true);
  if (
    typeof folder.revision !== "number" ||
    !Number.isSafeInteger(folder.revision) ||
    folder.revision < 0
  )
    throw Error("Некорректная версия папки");
  if (folder.parentId != null) text(folder.parentId, 100, true);
}

export function workspaceBackup(
  workspace: Workspace,
  extra?: { documents?: BackupDocument[]; folders?: BackupFolder[] },
): WorkspaceBackup {
  validateWorkspace(workspace);
  const documents = extra?.documents ?? [];
  const folders = extra?.folders ?? [];
  for (const doc of documents) validateBackupDocument(doc);
  for (const folder of folders) validateBackupFolder(folder);
  const withDocs = extra !== undefined;
  return {
    format: "sreda-backup",
    version: withDocs ? 2 : 1,
    workspace: structuredClone(workspace),
    ...(withDocs
      ? {
          documents: structuredClone(documents),
          folders: structuredClone(folders),
        }
      : {}),
  };
}

export function parseWorkspaceBackup(value: unknown): WorkspaceBackup {
  const file = object(value);
  keys(file, ["format", "version", "workspace"], ["documents", "folders"]);
  if (file.format !== "sreda-backup" || (file.version !== 1 && file.version !== 2))
    throw Error("Ожидался файл резервной копии Среда версии 1 или 2");
  validateWorkspace(file.workspace);
  const documents = file.documents ?? [];
  const folders = file.folders ?? [];
  if (!Array.isArray(documents) || !Array.isArray(folders))
    throw Error("Некорректный список документов в копии");
  if (documents.length > 5000 || folders.length > 1000)
    throw Error("В копии слишком много документов");
  for (const doc of documents) validateBackupDocument(doc);
  for (const folder of folders) validateBackupFolder(folder);
  return file as WorkspaceBackup;
}

export function parseBackupOrBoard(
  value: unknown,
): { kind: "backup"; file: WorkspaceBackup } | { kind: "board"; file: BoardFile } {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const format = (value as { format?: unknown }).format;
    if (format === "sreda-backup")
      return { kind: "backup", file: parseWorkspaceBackup(value) };
    if (format === "sreda-board")
      return { kind: "board", file: parseBoardFile(value) };
  }
  throw Error("Ожидался файл доски или резервной копии Среда версии 1");
}

export function importBackupBoards(file: WorkspaceBackup): Board[] {
  parseWorkspaceBackup(file);
  return file.workspace.boards.map((board) =>
    importCopy({ format: "sreda-board", version: 1, board }),
  );
}

