import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultProfile,
  initials,
  mergeUiPrefs,
  normalizeDisplayName,
  normalizeProfile,
  parseUiPrefs,
  validateDisplayName,
} from "../src/profile.ts";
import {
  emptyWorkspace,
  exampleBoard,
  importBackupBoards,
  parseBackupOrBoard,
  parseWorkspaceBackup,
  workspaceBackup,
  type Workspace,
} from "../src/model.ts";

test("display name is required and trimmed", () => {
  assert.equal(validateDisplayName(""), "Укажите, как вас представлять.");
  assert.equal(validateDisplayName("   "), "Укажите, как вас представлять.");
  assert.equal(validateDisplayName("Алексей"), undefined);
  assert.equal(validateDisplayName("  Анна  "), undefined);
  assert.match(validateDisplayName("а".repeat(41)) ?? "", /40/);
  assert.match(validateDisplayName("A\u0000B") ?? "", /недопустимые/);
});

test("default profile uses the OS name when it is usable, otherwise Вы", () => {
  assert.deepEqual(defaultProfile("alex"), {
    displayName: "alex",
    color: "sage",
  });
  assert.deepEqual(defaultProfile("  "), {
    displayName: "Вы",
    color: "sage",
  });
  assert.deepEqual(defaultProfile(null), {
    displayName: "Вы",
    color: "sage",
  });
  assert.equal(normalizeDisplayName("  Алексей  "), "Алексей");
  assert.equal(normalizeDisplayName("x".repeat(80)).length, 40);
});

test("normalizeProfile rejects an unknown colour and empty name", () => {
  assert.deepEqual(
    normalizeProfile({ displayName: "  Миша ", color: "rose" }),
    { displayName: "Миша", color: "rose" },
  );
  assert.deepEqual(normalizeProfile({ displayName: " ", color: "neon" }, "Иван"), {
    displayName: "Иван",
    color: "sage",
  });
  assert.deepEqual(normalizeProfile(null, "Вы"), {
    displayName: "Вы",
    color: "sage",
  });
});

test("ui prefs parse and merge keep the profile when only the theme changes", () => {
  const stored = parseUiPrefs({
    themeId: "paper",
    profile: { displayName: "Алексей", color: "blue" },
  });
  assert.deepEqual(stored, {
    themeId: "paper",
    profile: { displayName: "Алексей", color: "blue" },
  });
  const merged = mergeUiPrefs(stored, { themeId: "terminal" });
  assert.deepEqual(merged, {
    themeId: "terminal",
    profile: { displayName: "Алексей", color: "blue" },
  });
  const renamed = mergeUiPrefs(merged, {
    profile: { displayName: "Анна", color: "violet" },
  });
  assert.equal(renamed.themeId, "terminal");
  assert.deepEqual(renamed.profile, { displayName: "Анна", color: "violet" });
  const empty = parseUiPrefs(undefined, { fallbackName: "alex" });
  assert.equal(empty.themeId, "graphite");
  assert.equal(empty.profile.displayName, "alex");
});

test("initials take the first letters of one or two words", () => {
  assert.equal(initials("Алексей"), "А");
  assert.equal(initials("Иван Петров"), "ИП");
  assert.equal(initials("  анна-мария  "), "АМ");
  assert.equal(initials(""), "В");
});

test("workspace backup round-trips and import copies boards with new ids", () => {
  const workspace: Workspace = {
    schemaVersion: 1,
    selectedBoardId: "keep",
    boards: [exampleBoard(), { ...exampleBoard(), id: "keep", name: "Вторая" }],
  };
  workspace.selectedBoardId = workspace.boards[0].id;
  const file = workspaceBackup(workspace);
  assert.equal(file.format, "sreda-backup");
  assert.equal(file.version, 1);
  const parsed = parseWorkspaceBackup(JSON.parse(JSON.stringify(file)));
  assert.equal(parsed.workspace.boards.length, 2);
  const copies = importBackupBoards(parsed);
  assert.equal(copies.length, 2);
  assert.notEqual(copies[0].id, parsed.workspace.boards[0].id);
  assert.notEqual(copies[0].columns[0].id, parsed.workspace.boards[0].columns[0].id);
  assert.equal(copies[0].name, parsed.workspace.boards[0].name);
  const board = parseBackupOrBoard({
    format: "sreda-board",
    version: 1,
    board: exampleBoard(),
  });
  assert.equal(board.kind, "board");
  assert.throws(() => parseWorkspaceBackup({ format: "sreda-board", version: 1, board: exampleBoard() }));
  assert.throws(() => parseBackupOrBoard(emptyWorkspace()));
});
