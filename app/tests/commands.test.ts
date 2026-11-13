import { test } from "node:test";
import assert from "node:assert/strict";
import { createCommandQueue } from "../src/commands.ts";
import { emptyWorkspace, newBoard } from "../src/model.ts";
import type { Snapshot } from "../src/model.ts";
test("queued writes use confirmed revisions; failed disk writes never change visible data and can be retried", async () => {
  let snapshot: Snapshot = { revision: 0, workspace: emptyWorkspace() },
    pending = 0,
    error = "",
    fail = false;
  const revisions: number[] = [];
  const queue = createCommandQueue({
    get: () => snapshot,
    confirmed: (next) => {
      snapshot = next;
    },
    save: async (_state, revision) => {
      revisions.push(revision);
      await new Promise((r) => setTimeout(r, 5));
      if (fail) throw Error("Disk full");
      return revision + 1;
    },
    pending: (n) => {
      pending += n;
    },
    error: (message) => {
      error = message;
    },
  });
  const a = newBoard("A"),
    b = newBoard("B");
  const one = queue.commit({ type: "board.add", board: a }),
    two = queue.commit({ type: "board.add", board: b });
  assert.equal(snapshot.workspace.boards.length, 0);
  assert.equal(pending, 2);
  assert.deepEqual(await Promise.all([one, two]), [true, true]);
  assert.deepEqual(revisions, [0, 1]);
  assert.equal(snapshot.workspace.boards.length, 2);
  fail = true;
  const before = structuredClone(snapshot);
  assert.equal(
    await queue.commit({
      type: "board.rename",
      id: a.id,
      name: "Не записано",
      description: "",
    }),
    false,
  );
  assert.deepEqual(snapshot, before);
  assert.match(error, /Disk full/);
  assert.equal(pending, 0);
  fail = false;
  assert.equal(
    await queue.commit({
      type: "board.rename",
      id: a.id,
      name: "Записано",
      description: "",
    }),
    true,
  );
  assert.equal(snapshot.revision, 3);
  assert.equal(snapshot.workspace.boards[0].name, "Записано");
  assert.equal(error, "");
  await queue.idle();
  assert.equal(pending, 0);
});
test("invalid operation does not poison the queue or call storage", async () => {
  let snapshot: Snapshot = { revision: 0, workspace: emptyWorkspace() },
    writes = 0;
  const queue = createCommandQueue({
    get: () => snapshot,
    confirmed: (next) => {
      snapshot = next;
    },
    save: async (_state, r) => {
      writes++;
      return r + 1;
    },
    pending: () => {},
    error: () => {},
  });
  assert.equal(
    await queue.commit({ type: "board.add", board: newBoard(" ") }),
    false,
  );
  assert.equal(writes, 0);
  assert.equal(
    await queue.commit({ type: "board.add", board: newBoard("Доска") }),
    true,
  );
  assert.equal(writes, 1);
});
