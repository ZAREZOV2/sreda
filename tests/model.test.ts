import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyAction,
  boardFile,
  deletedTask,
  emptyWorkspace,
  exampleBoard,
  importCopy,
  newBoard,
  inferColumnKind,
  parseBoardFile,
  uid,
  validateWorkspace,
} from "../src/model.ts";
import type { Task } from "../src/model.ts";
const task = (title: string): Task => ({
  id: uid(),
  title,
  description: "Описание\nс новой строкой",
  label: "Интерфейс",
  color: "sage",
  priority: "medium",
});
function setup() {
  const b = newBoard("Работа");
  const state = applyAction(emptyWorkspace(), { type: "board.add", board: b });
  return { b, state, c: b.columns.map((c) => c.id) };
}
test("board CRUD, defaults, selection, and immutable input", () => {
  let { b, state } = setup();
  assert.deepEqual(
    b.columns.map((c) => c.name),
    ["Нужно сделать", "В работе", "Готово"],
  );
  const before = structuredClone(state);
  state = applyAction(state, {
    type: "board.rename",
    id: b.id,
    name: " Новое имя ",
    description: "Контекст",
  });
  assert.equal(state.boards[0].name, "Новое имя");
  assert.equal(before.boards[0].name, "Работа");
  const next = newBoard("Вторая");
  state = applyAction(state, { type: "board.add", board: next });
  assert.equal(state.selectedBoardId, next.id);
  state = applyAction(state, { type: "board.select", id: b.id });
  state = applyAction(state, { type: "board.delete", id: b.id });
  assert.equal(state.selectedBoardId, next.id);
  state = applyAction(state, { type: "board.delete", id: next.id });
  assert.deepEqual(state, emptyWorkspace());
});
test("columns add, rename, reorder, delete; last column protected", () => {
  let { b, state, c } = setup();
  const extra = { id: uid(), name: "На проверке", kind: "todo" as const, tasks: [] };
  state = applyAction(state, {
    type: "column.add",
    boardId: b.id,
    column: extra,
  });
  state = applyAction(state, {
    type: "column.rename",
    boardId: b.id,
    id: extra.id,
    name: "Проверка",
  });
  state = applyAction(state, {
    type: "column.move",
    boardId: b.id,
    id: extra.id,
    direction: -1,
  });
  assert.deepEqual(
    state.boards[0].columns.map((c) => c.id),
    [c[0], c[1], extra.id, c[2]],
  );
  for (const id of [extra.id, c[0], c[1]])
    state = applyAction(state, {
      type: "column.delete",
      boardId: b.id,
      id,
      targetId: null,
    });
  assert.throws(
    () =>
      applyAction(state, {
        type: "column.delete",
        boardId: b.id,
        id: c[2],
        targetId: null,
      }),
    /хотя бы одна/,
  );
});
test("nonempty column requires destination and preserves both task orders", () => {
  let { b, state, c } = setup();
  const a = task("A"),
    bb = task("B"),
    cc = task("C");
  for (const t of [a, bb])
    state = applyAction(state, {
      type: "task.add",
      boardId: b.id,
      columnId: c[0],
      task: t,
    });
  state = applyAction(state, {
    type: "task.add",
    boardId: b.id,
    columnId: c[1],
    task: cc,
  });
  assert.throws(
    () =>
      applyAction(state, {
        type: "column.delete",
        boardId: b.id,
        id: c[0],
        targetId: null,
      }),
    /Выберите/,
  );
  assert.throws(() =>
    applyAction(state, {
      type: "column.delete",
      boardId: b.id,
      id: c[0],
      targetId: c[0],
    }),
  );
  state = applyAction(state, {
    type: "column.delete",
    boardId: b.id,
    id: c[0],
    targetId: c[1],
  });
  assert.deepEqual(
    state.boards[0].columns[0].tasks.map((t) => t.title),
    ["C", "A", "B"],
  );
});
test("task updates every field and can change its column", () => {
  let { b, state, c } = setup();
  const t = task("Первая");
  state = applyAction(state, {
    type: "task.add",
    boardId: b.id,
    columnId: c[0],
    task: t,
  });
  const update: Task = {
    ...t,
    title: "Исправленная",
    description: "Новые детали",
    label: "Ошибка",
    color: "rose",
    priority: "high",
  };
  state = applyAction(state, {
    type: "task.update",
    boardId: b.id,
    columnId: c[1],
    task: update,
  });
  assert.equal(state.boards[0].columns[0].tasks.length, 0);
  assert.deepEqual(state.boards[0].columns[1].tasks, [update]);
});
test("DnD same-column: forward, backward, self, append", () => {
  let { b, state, c } = setup();
  const tasks = ["A", "B", "C", "D"].map(task);
  for (const t of tasks)
    state = applyAction(state, {
      type: "task.add",
      boardId: b.id,
      columnId: c[0],
      task: t,
    });
  const names = () => state.boards[0].columns[0].tasks.map((t) => t.title);
  state = applyAction(state, {
    type: "task.move",
    boardId: b.id,
    id: tasks[0].id,
    columnId: c[0],
    beforeId: tasks[3].id,
  });
  assert.deepEqual(names(), ["B", "C", "A", "D"]);
  state = applyAction(state, {
    type: "task.move",
    boardId: b.id,
    id: tasks[3].id,
    columnId: c[0],
    beforeId: tasks[1].id,
  });
  assert.deepEqual(names(), ["D", "B", "C", "A"]);
  state = applyAction(state, {
    type: "task.move",
    boardId: b.id,
    id: tasks[3].id,
    columnId: c[0],
    beforeId: tasks[3].id,
  });
  assert.deepEqual(names(), ["D", "B", "C", "A"]);
  state = applyAction(state, {
    type: "task.move",
    boardId: b.id,
    id: tasks[3].id,
    columnId: c[0],
  });
  assert.deepEqual(names(), ["B", "C", "A", "D"]);
});
test("DnD cross-column and relative anchors preserve hidden tasks", () => {
  let { b, state, c } = setup();
  const [a, hidden, last] = ["Source", "Hidden", "Visible"].map(task);
  state = applyAction(state, {
    type: "task.add",
    boardId: b.id,
    columnId: c[0],
    task: a,
  });
  for (const t of [hidden, last])
    state = applyAction(state, {
      type: "task.add",
      boardId: b.id,
      columnId: c[1],
      task: t,
    });
  state = applyAction(state, {
    type: "task.move",
    boardId: b.id,
    id: a.id,
    columnId: c[1],
    beforeId: last.id,
  });
  assert.equal(state.boards[0].columns[0].tasks.length, 0);
  assert.deepEqual(
    state.boards[0].columns[1].tasks.map((t) => t.title),
    ["Hidden", "Source", "Visible"],
  );
  assert.throws(() =>
    applyAction(state, {
      type: "task.move",
      boardId: b.id,
      id: a.id,
      columnId: c[2],
      beforeId: "missing",
    }),
  );
  assert.deepEqual(
    state.boards[0].columns[1].tasks.map((t) => t.title),
    ["Hidden", "Source", "Visible"],
  );
});
test("delete + undo restores exact content and index without reverting other edits", () => {
  let { b, state, c } = setup();
  const [a, bb, cc] = ["A", "B", "C"].map(task);
  for (const t of [a, bb, cc])
    state = applyAction(state, {
      type: "task.add",
      boardId: b.id,
      columnId: c[0],
      task: t,
    });
  const deleted = deletedTask(state, b.id, bb.id);
  state = applyAction(state, { type: "task.delete", boardId: b.id, id: bb.id });
  state = applyAction(state, {
    type: "board.rename",
    id: b.id,
    name: "Изменено после удаления",
    description: "",
  });
  state = applyAction(state, { type: "task.restore", deleted });
  assert.deepEqual(state.boards[0].columns[0].tasks, [a, bb, cc]);
  assert.equal(state.boards[0].name, "Изменено после удаления");
  assert.throws(
    () => applyAction(state, { type: "task.restore", deleted }),
    /уже восстановлена/,
  );
});
test("undo reports removed source column instead of losing the task silently", () => {
  let { b, state, c } = setup();
  const t = task("Задача");
  state = applyAction(state, {
    type: "task.add",
    boardId: b.id,
    columnId: c[0],
    task: t,
  });
  const deleted = deletedTask(state, b.id, t.id);
  state = applyAction(state, { type: "task.delete", boardId: b.id, id: t.id });
  state = applyAction(state, {
    type: "column.delete",
    boardId: b.id,
    id: c[0],
    targetId: null,
  });
  assert.throws(
    () => applyAction(state, { type: "task.restore", deleted }),
    /Исходная колонка удалена/,
  );
});
test("export/import roundtrip and separate copy IDs", () => {
  const board = exampleBoard();
  const file = parseBoardFile(JSON.parse(JSON.stringify(boardFile(board))));
  assert.deepEqual(file.board, board);
  const copy = importCopy(file);
  assert.notEqual(copy.id, board.id);
  assert.notEqual(copy.columns[0].id, board.columns[0].id);
  assert.notEqual(copy.columns[0].tasks[0].id, board.columns[0].tasks[0].id);
  assert.deepEqual(
    copy.columns.map((c) => c.tasks.map((t) => t.title)),
    board.columns.map((c) => c.tasks.map((t) => t.title)),
  );
  let state = applyAction(emptyWorkspace(), { type: "board.add", board });
  state = applyAction(state, { type: "board.add", board: copy });
  validateWorkspace(state);
  assert.equal(state.boards.length, 2);
});
test("import rejects wrong version, unknown fields, invalid shapes and duplicate IDs", () => {
  const file = boardFile(exampleBoard());
  for (const bad of [
    null,
    [],
    { ...file, version: 2 },
    { ...file, format: "other" },
    { ...file, extra: true },
    { ...file, board: { ...file.board, columns: [] } },
  ])
    assert.throws(() => parseBoardFile(bad));
  const duplicate = structuredClone(file);
  duplicate.board.columns[1].id = duplicate.board.columns[0].id;
  assert.throws(() => parseBoardFile(duplicate));
  const badPriority = structuredClone(file);
  (
    badPriority.board.columns[0].tasks[0] as unknown as { priority: string }
  ).priority = "urgent";
  assert.throws(() => parseBoardFile(badPriority));
});
test("invariants reject blank names, duplicate task IDs, missing objects and oversized text", () => {
  let { b, state, c } = setup();
  assert.throws(() =>
    applyAction(state, {
      type: "board.rename",
      id: b.id,
      name: " ",
      description: "",
    }),
  );
  assert.throws(() =>
    applyAction(state, {
      type: "column.rename",
      boardId: b.id,
      id: c[0],
      name: "a".repeat(81),
    }),
  );
  const t = task("Тест");
  state = applyAction(state, {
    type: "task.add",
    boardId: b.id,
    columnId: c[0],
    task: t,
  });
  assert.throws(() =>
    applyAction(state, {
      type: "task.add",
      boardId: b.id,
      columnId: c[1],
      task: t,
    }),
  );
  assert.throws(() =>
    applyAction(state, {
      type: "task.update",
      boardId: b.id,
      columnId: c[0],
      task: { ...t, id: "missing" },
    }),
  );
  assert.throws(() =>
    applyAction(state, {
      type: "task.add",
      boardId: b.id,
      columnId: c[0],
      task: { ...t, id: uid(), title: " " },
    }),
  );
});

test("new boards get stable column kinds; kinds can be changed independently of the name", () => {
  let { b, state, c } = setup();
  assert.deepEqual(
    state.boards[0].columns.map((col) => col.kind),
    ["todo", "progress", "done"],
  );
  state = applyAction(state, {
    type: "column.setKind",
    boardId: b.id,
    id: c[2],
    kind: "todo",
  });
  assert.equal(state.boards[0].columns[2].kind, "todo");
  assert.equal(state.boards[0].columns[2].name, "Готово");
  assert.throws(() =>
    applyAction(state, {
      type: "column.setKind",
      boardId: b.id,
      id: "missing",
      kind: "done",
    }),
  );
});

test("legacy boards without kind are migrated from the name or position", () => {
  const legacy = {
    format: "sreda-board",
    version: 1,
    board: {
      id: "board-1",
      name: "Наследие",
      description: "",
      columns: [
        { id: "c-todo", name: "Нужно сделать", tasks: [] },
        { id: "c-prog", name: "В работе", tasks: [] },
        { id: "c-done", name: "Готово", tasks: [] },
        { id: "c-alt", name: "ГОТОВО", tasks: [] },
        { id: "c-other", name: "Прочее", tasks: [] },
      ],
    },
  };
  const file = parseBoardFile(legacy);
  assert.deepEqual(
    file.board.columns.map((c) => c.kind),
    ["todo", "progress", "done", "done", "todo"],
  );
  const positional = parseBoardFile({
    format: "sreda-board",
    version: 1,
    board: {
      id: "board-2",
      name: "Позиции",
      description: "",
      columns: [
        { id: "a", name: "Архив", tasks: [] },
        { id: "b", name: "Текущее", tasks: [] },
        { id: "c", name: "Потом", tasks: [] },
      ],
    },
  });
  assert.deepEqual(
    positional.board.columns.map((col) => col.kind),
    ["todo", "progress", "done"],
  );
  assert.equal(inferColumnKind("готово", 0, 1), "done");
  const withKind = parseBoardFile({
    format: "sreda-board",
    version: 1,
    board: {
      id: "board-3",
      name: "Уже с типом",
      description: "",
      columns: [{ id: "x", name: "Готово", kind: "todo", tasks: [] }],
    },
  });
  assert.equal(withKind.board.columns[0].kind, "todo");
  const bad = structuredClone(legacy);
  (bad.board.columns[0] as { kind?: string }).kind = "urgent";
  assert.throws(() => parseBoardFile(bad), /тип колонки/);
});
