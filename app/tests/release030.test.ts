import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { parseChangelog } from "../src/changelog.ts";
import {
  applyAction,
  exampleBoard,
  newBoard,
  parseWorkspaceBackup,
  uid,
  validateWorkspace,
  workspaceBackup,
  type Task,
} from "../src/model.ts";
import {
  backlinkTitles,
  parseChecklist,
  parseWikiLinks,
  replaceChecklistLine,
  setChecklistChecked,
  tableOfContents,
  templates,
} from "../src/markdown/text.ts";
import { nextOccurrence } from "../src/recurrence.ts";
import { dueReminders, reminderKey } from "../src/reminders.ts";
import { contrastRatio, contrastWarnings } from "../src/themeContrast.ts";

test("changelog lists 0.3.0 first and keeps earlier releases", () => {
  const text = fs.readFileSync(new URL("../../CHANGELOG.md", import.meta.url), "utf8");
  const notes = parseChangelog(text);
  assert.equal(notes[0]?.version, "0.3.0");
  assert.ok(notes.some((item) => item.version === "0.2.3"));
  assert.ok(notes.some((item) => item.version === "0.2.0"));
  const versions = notes.map((item) => item.version);
  assert.deepEqual(versions, [...versions].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)));
  assert.ok(notes[0].body.includes("MCP"));
});

test("changelog parser keeps title, date and body", () => {
  const notes = parseChangelog(`# Журнал

## 1.2.0 — 2026-01-02 — Заголовок

Первая строка

## 1.0.0 — Начало

Текст
`);
  assert.equal(notes.length, 2);
  assert.equal(notes[0].date, "2026-01-02");
  assert.equal(notes[0].title, "Заголовок");
  assert.equal(notes[0].body, "Первая строка");
  assert.equal(notes[1].date, null);
  assert.equal(notes[1].title, "Начало");
});

test("checklist round-trip links a card and toggles it", () => {
  const source = "# Список\n\n- [ ] Написать тест\n- [x] Готово <!-- sreda-card:card-1 -->\n```\n- [ ] не задача\n```\n";
  const items = parseChecklist(source);
  assert.equal(items.length, 2);
  assert.equal(items[0].text, "Написать тест");
  assert.equal(items[1].cardId, "card-1");
  assert.equal(items[1].checked, true);
  const linked = replaceChecklistLine(source, { ...items[0], cardId: "card-2" });
  assert.match(linked, /sreda-card:card-2/);
  const flipped = setChecklistChecked(linked, "card-1", false);
  assert.match(flipped, /- \[ \] Готово <!-- sreda-card:card-1 -->/);
});

test("wiki links, backlinks and table of contents skip code fences", () => {
  const md = "# Обзор\n\nСмотри [[План]] и [[card:Макет]].\n\n```\n[[Скрыто]]\n```\n\n## Детали\n";
  const links = parseWikiLinks(md);
  assert.deepEqual(
    links.map((link) => [link.title, link.card]),
    [
      ["План", false],
      ["Макет", true],
    ],
  );
  assert.deepEqual(backlinkTitles(md), ["План"]);
  assert.deepEqual(
    tableOfContents(md).map((item) => item.text),
    ["Обзор", "Детали"],
  );
  assert.equal(templates.length, 3);
});

test("finishing a recurring task spawns the next copy in todo", () => {
  const board = newBoard("Ритм");
  const task: Task = {
    id: "task-1",
    title: "Стендап",
    description: "",
    label: "",
    color: "blue",
    priority: "medium",
    recurrence: { freq: "weekly", interval: 1 },
    reminderAt: Date.UTC(2026, 0, 5),
  };
  board.columns[0].tasks.push(task);
  const moved = applyAction(
    { schemaVersion: 1, boards: [board], selectedBoardId: board.id },
    {
      type: "task.move",
      boardId: board.id,
      id: "task-1",
      columnId: board.columns[2].id,
    },
  );
  const done = moved.boards[0].columns[2].tasks[0];
  const next = moved.boards[0].columns[0].tasks[0];
  assert.equal(done.recurrence, undefined);
  assert.equal(next.title, "Стендап");
  assert.deepEqual(next.recurrence, { freq: "weekly", interval: 1 });
  assert.equal(next.reminderAt, nextOccurrence(Date.UTC(2026, 0, 5), next.recurrence!));
  assert.notEqual(next.id, done.id);
  validateWorkspace(moved);
});

test("backup version 2 keeps documents and version 1 still imports", () => {
  const workspace = {
    schemaVersion: 1 as const,
    boards: [exampleBoard()],
    selectedBoardId: null as string | null,
  };
  workspace.selectedBoardId = workspace.boards[0].id;
  const legacy = workspaceBackup(workspace);
  assert.equal(legacy.version, 1);
  assert.equal(parseWorkspaceBackup(legacy).documents, undefined);
  const file = workspaceBackup(workspace, {
    documents: [
      {
        id: "doc-1",
        title: "Заметка",
        markdown: "# Привет",
        revision: 2,
        folderId: "folder-1",
      },
    ],
    folders: [{ id: "folder-1", name: "Работа", revision: 1 }],
  });
  assert.equal(file.version, 2);
  const parsed = parseWorkspaceBackup(JSON.parse(JSON.stringify(file)));
  assert.equal(parsed.documents?.[0].title, "Заметка");
  assert.equal(parsed.folders?.[0].name, "Работа");
  assert.throws(() =>
    parseWorkspaceBackup({ format: "sreda-backup", version: 3, workspace }),
  );
});

test("reminders fire once and contrast warns on weak pairs", () => {
  const task = { id: "t", title: "Созвон", reminderAt: 100 };
  const due = dueReminders([task, { id: "later", title: "Потом", reminderAt: 500 }], 200, new Set());
  assert.deepEqual(due.map((item) => item.id), ["t"]);
  const again = dueReminders([task], 200, new Set([reminderKey(task)]));
  assert.equal(again.length, 0);
  const ratio = contrastRatio("#161719", "#edf0f4");
  assert.ok(ratio && ratio > 10);
  const warnings = contrastWarnings({
    text: "#777777",
    bg: "#888888",
    surface: "#888888",
    "text-secondary": "#888888",
    muted: "#888888",
    "on-primary": "#ffffff",
    primary: "#eeeeee",
    "on-danger": "#ffffff",
    danger: "#eeeeee",
    "accent-text": "#999999",
  });
  assert.ok(warnings.length >= 1);
  assert.ok(warnings.every((item) => item.ratio < item.minimum));
  void uid;
});
