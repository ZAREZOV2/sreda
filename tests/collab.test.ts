import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyWorkspace, newBoard } from "../src/model.ts";
import {
  applyHostClosed,
  reattachOrCreate,
} from "../src/collab/closeFlow.ts";
import {
  initialCollabState,
  nextBackoffMs,
  reduceCollab,
  shouldAutoReconnect,
  type CollabState,
} from "../src/collab/reducer.ts";
import { DISCONNECTED_NEW_LINK_HINT, disconnectedHint } from "../src/share.ts";
import type { GuestBoard, InvitePayload } from "../src/share.ts";

const invite: InvitePayload = {
  format: "sreda-invite",
  version: 1,
  workspaceId: "ws_alpha",
  hostId: "host_lucas",
  url: "https://sreda.ngrok.app",
  staticDomain: true,
  token: "a".repeat(43),
};

function online(): CollabState {
  const board = newBoard("Общая");
  return reduceCollab(initialCollabState(), {
    type: "welcome",
    snapshot: {
      revision: 3,
      workspace: {
        schemaVersion: 1,
        boards: [board],
        selectedBoardId: board.id,
      },
    },
    selfId: "guest_1",
    workspaceId: invite.workspaceId,
    hostId: invite.hostId,
    staticDomain: true,
    participants: [],
  });
}

test("reducer goes online on welcome and replaces state on host pushes", () => {
  let state = reduceCollab(initialCollabState(), {
    type: "connecting",
    invite,
  });
  assert.equal(state.status, "connecting");
  state = online();
  assert.equal(state.status, "online");
  assert.equal(state.snapshot?.revision, 3);
  const nextBoard = newBoard("Обновлено");
  state = reduceCollab(state, {
    type: "state",
    revision: 4,
    workspace: {
      schemaVersion: 1,
      boards: [nextBoard],
      selectedBoardId: nextBoard.id,
    },
    originId: "host_lucas",
  });
  assert.equal(state.snapshot?.revision, 4);
  assert.equal(state.snapshot?.workspace.boards[0].name, "Обновлено");
});

test("rejected push restores the server snapshot", () => {
  let state = online();
  const board = newBoard("Серверная");
  state = reduceCollab(state, {
    type: "rejected",
    expectedRevision: 5,
    message: "Данные изменились в другом окне. Обновите данные и повторите действие.",
    snapshot: {
      revision: 5,
      workspace: {
        schemaVersion: 1,
        boards: [board],
        selectedBoardId: board.id,
      },
    },
  });
  assert.equal(state.snapshot?.revision, 5);
  assert.match(state.error, /другом окне/);
});

test("host shutdown opens the closed flow; drop without static domain does not auto-reconnect", () => {
  let state = online();
  state = reduceCollab(state, { type: "host_closed", reason: "closed" });
  assert.equal(state.status, "closed");
  assert.equal(state.hostClosed, true);
  assert.equal(shouldAutoReconnect(state), false);

  state = { ...online(), staticDomain: false, invite: { ...invite, staticDomain: false, url: "https://tmp.ngrok-free.app" } };
  state = reduceCollab(state, { type: "disconnected" });
  assert.equal(state.status, "disconnected");
  assert.equal(shouldAutoReconnect(state), false);
});

test("auto-reconnect is allowed only when a static domain is configured", () => {
  let state = { ...online(), status: "disconnected" as const, invite, staticDomain: true, hostClosed: false };
  assert.equal(shouldAutoReconnect(state), true);
  assert.equal(nextBackoffMs(0), 500);
  assert.equal(nextBackoffMs(1), 1000);
  assert.equal(nextBackoffMs(10), 15_000);
});

test("close flow can keep a disconnected board or save a local copy without duplicating later", () => {
  const board = newBoard("Гостевая");
  const records: GuestBoard[] = [
    {
      workspaceId: invite.workspaceId,
      hostId: invite.hostId,
      board,
      status: "connected",
      inviteUrl: invite.url,
      staticDomain: false,
    },
  ];
  const kept = applyHostClosed(records, invite, null, "keep-disconnected");
  assert.equal(kept.localCopies.length, 0);
  assert.equal(kept.records[0].status, "disconnected");
  assert.equal(disconnectedHint(kept.records[0]), DISCONNECTED_NEW_LINK_HINT);

  const workspace = {
    schemaVersion: 1 as const,
    boards: [board],
    selectedBoardId: board.id,
  };
  const saved = applyHostClosed(records, invite, workspace, "save-local");
  assert.equal(saved.records.length, 0);
  assert.equal(saved.localCopies.length, 1);
  assert.notEqual(saved.localCopies[0].id, board.id);

  const reattached = reattachOrCreate(kept.records, invite, newBoard("Снова онлайн"));
  assert.equal(reattached.action, "reattach");
  assert.equal(reattached.records.length, 1);
  assert.equal(reattached.board.status, "connected");
  assert.equal(reattached.board.board.name, "Снова онлайн");
});

test("a different workspace still creates a separate guest board", () => {
  const existing: GuestBoard[] = [
    {
      workspaceId: invite.workspaceId,
      hostId: invite.hostId,
      board: newBoard("Старая"),
      status: "disconnected",
      inviteUrl: invite.url,
      staticDomain: false,
    },
  ];
  const created = reattachOrCreate(
    existing,
    { ...invite, workspaceId: "ws_other" },
    newBoard("Другая"),
  );
  assert.equal(created.action, "create");
  assert.equal(created.records.length, 2);
});

import {
  hasFieldErrors,
  validateGuestName,
  validateInviteInput,
  validateJoinForm,
  validateShareSettings,
  validateStaticDomain,
} from "../src/collab/validate.ts";
import { encodeInviteLink } from "../src/share.ts";

test("share settings accept empty optional fields and reject a domain without a token", () => {
  assert.deepEqual(
    validateShareSettings({ ngrokAuthtoken: "", staticDomain: "" }),
    {},
  );
  assert.equal(hasFieldErrors(validateShareSettings({ ngrokAuthtoken: "", staticDomain: "" })), false);
  const domainOnly = validateShareSettings({
    ngrokAuthtoken: "",
    staticDomain: "sreda.ngrok.app",
  });
  assert.match(domainOnly.staticDomain ?? "", /токен ngrok/);
  assert.equal(
    validateStaticDomain("https://sreda.ngrok.app", "ngrok_abcdefgh"),
    "Укажите только имя домена, без https://.",
  );
  assert.equal(
    validateShareSettings({
      ngrokAuthtoken: "ngrok_abcdefgh",
      staticDomain: "sreda.ngrok.app",
    }).staticDomain,
    undefined,
  );
  assert.match(
    validateShareSettings({ ngrokAuthtoken: "too short", staticDomain: "" }).token ??
      "",
    /не токен ngrok/,
  );
});

test("join form requires a valid invite and a guest name", () => {
  assert.equal(validateInviteInput(""), "Вставьте ссылку-приглашение.");
  assert.equal(validateGuestName("   "), "Укажите, как вас представлять.");
  assert.match(validateGuestName("и".repeat(41)) ?? "", /слишком длинное/);
  const bad = validateJoinForm("not-a-link", "");
  assert.ok(bad.link);
  assert.equal(bad.name, "Укажите, как вас представлять.");
  const link = encodeInviteLink({
    format: "sreda-invite",
    version: 1,
    workspaceId: "ws_alpha",
    hostId: "host_lucas",
    url: "https://sreda.ngrok.app",
    staticDomain: true,
    token: "a".repeat(43),
  });
  assert.deepEqual(validateJoinForm(link, "Анна"), {});
});
