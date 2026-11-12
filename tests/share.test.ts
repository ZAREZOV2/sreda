import { test } from "node:test";
import assert from "node:assert/strict";
import { newBoard, type Board } from "../src/model.ts";
import {
  DISCONNECTED_NEW_LINK_HINT,
  applyInvite,
  canAutoReconnect,
  createInvite,
  disconnectedHint,
  encodeInviteLink,
  parseInviteLink,
  resolveInvite,
  sameSharedWorkspace,
  type GuestBoard,
} from "../src/share.ts";

const host = {
  workspaceId: "ws_alpha",
  hostId: "host_lucas",
};

function invite(overrides: Partial<Parameters<typeof createInvite>[0]> = {}) {
  return createInvite({
    ...host,
    url: "https://first.ngrok-free.app",
    staticDomain: false,
    ...overrides,
  });
}

function guest(overrides: Partial<GuestBoard> = {}): GuestBoard {
  return {
    workspaceId: host.workspaceId,
    hostId: host.hostId,
    board: newBoard("Удалённая доска"),
    status: "disconnected",
    inviteUrl: "https://first.ngrok-free.app",
    staticDomain: false,
    ...overrides,
  };
}

function board(name: string): Board {
  const value = newBoard(name);
  value.description = "Состояние хозяина";
  return value;
}

test("invite link roundtrips workspaceId, host and static-domain flag", () => {
  const payload = invite({
    url: "https://sreda.ngrok.app/join",
    staticDomain: true,
  });
  const link = encodeInviteLink(payload);
  assert.match(link, /^https:\/\/sreda\.ngrok\.app\/join#sreda-invite=/);
  assert.deepEqual(parseInviteLink(link), payload);
  assert.deepEqual(parseInviteLink("  " + link + "  "), payload);
});

test("resolveInvite reattaches a disconnected board with the same workspace and host", () => {
  const stale = guest();
  const other = guest({
    workspaceId: "ws_other",
    board: newBoard("Другое пространство"),
  });
  const resolution = resolveInvite([stale, other], invite());
  assert.equal(resolution.action, "reattach");
  if (resolution.action === "reattach") assert.equal(resolution.target, stale);
});

test("a new invite with the same workspaceId updates the disconnected board instead of duplicating it", () => {
  const stale = guest();
  const incoming = board("Актуальная доска");
  const link = invite({ url: "https://second.ngrok-free.app" });
  const result = applyInvite([stale], link, incoming);
  assert.equal(result.action, "reattach");
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0], result.board);
  assert.equal(result.board.status, "connected");
  assert.equal(result.board.workspaceId, host.workspaceId);
  assert.equal(result.board.hostId, host.hostId);
  assert.equal(result.board.inviteUrl, "https://second.ngrok-free.app");
  assert.equal(result.board.board.name, "Актуальная доска");
  assert.equal(result.board.board.description, "Состояние хозяина");
  assert.notEqual(result.board.board.id, stale.board.id);
});

test("a different workspaceId or host identity creates a new guest board", () => {
  const stale = guest();
  const byWorkspace = applyInvite(
    [stale],
    invite({ workspaceId: "ws_beta", url: "https://new.ngrok-free.app" }),
    board("Другое пространство"),
  );
  assert.equal(byWorkspace.action, "create");
  assert.equal(byWorkspace.records.length, 2);
  assert.equal(byWorkspace.records[0], stale);
  assert.equal(byWorkspace.board.workspaceId, "ws_beta");

  const byHost = applyInvite(
    [stale],
    invite({ hostId: "host_other" }),
    board("Другой владелец"),
  );
  assert.equal(byHost.action, "create");
  assert.equal(byHost.records.length, 2);
  assert.equal(byHost.board.hostId, "host_other");
});

test("pasting a link for an already connected workspace updates it and still does not duplicate", () => {
  const live = guest({ status: "connected" });
  const result = applyInvite(
    [live],
    invite({ url: "https://third.ngrok-free.app" }),
    board("Обновление"),
  );
  assert.equal(result.action, "reattach");
  assert.equal(result.records.length, 1);
  assert.equal(result.board.status, "connected");
  assert.equal(result.board.board.name, "Обновление");
});

test("sameSharedWorkspace requires both workspaceId and hostId", () => {
  const record = guest();
  assert.equal(sameSharedWorkspace(record, invite()), true);
  assert.equal(
    sameSharedWorkspace(record, invite({ workspaceId: "ws_x" })),
    false,
  );
  assert.equal(
    sameSharedWorkspace(record, invite({ hostId: "host_x" })),
    false,
  );
});

test("without a static domain the disconnected board cannot auto-reconnect and asks for a new link", () => {
  const record = guest({ staticDomain: false });
  assert.equal(canAutoReconnect(record), false);
  assert.equal(disconnectedHint(record), DISCONNECTED_NEW_LINK_HINT);
  assert.equal(disconnectedHint({ ...record, status: "connected" }), null);
});

test("a static domain allows auto-reconnect with the same URL and hides the new-link hint", () => {
  const record = guest({
    staticDomain: true,
    inviteUrl: "https://sreda.ngrok.app",
    status: "disconnected",
  });
  assert.equal(canAutoReconnect(record), true);
  assert.equal(disconnectedHint(record), null);
  assert.equal(canAutoReconnect({ ...record, inviteUrl: "  " }), false);
  assert.equal(canAutoReconnect({ ...record, status: "connected" }), false);
});

test("parseInviteLink rejects malformed input", () => {
  assert.throws(() => parseInviteLink(""), /Вставьте/);
  assert.throws(
    () => parseInviteLink("https://example.com/just-a-page"),
    /не ссылка/,
  );
  assert.throws(() => parseInviteLink("sreda-invite=%%%"), /не ссылка|Некорректная/);
  const broken = invite();
  (broken as { version: number }).version = 2;
  const encoded = encodeInviteLink({ ...invite(), url: "https://ok.example" });
  // version is baked in encodeInviteLink via createInvite, so craft a bad hash manually
  assert.throws(
    () => parseInviteLink("https://ok.example/#sreda-invite=e30"),
    /Ожидалась|Некорректная/,
  );
  void broken;
  void encoded;
});
