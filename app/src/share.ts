import { validateBoard, type Board } from "./model.ts";

export const DISCONNECTED_NEW_LINK_HINT = "Попросите у владельца новую ссылку";

export type GuestBoardStatus = "connected" | "disconnected";

export type GuestBoard = {
  workspaceId: string;
  hostId: string;
  board: Board;
  status: GuestBoardStatus;
  inviteUrl: string;
  staticDomain: boolean;
  token?: string;
};

export type InvitePayload = {
  format: "sreda-invite";
  version: 2;
  workspaceId: string;
  hostId: string;
  boardId: string;
  role: "view" | "edit";
  url: string;
  staticDomain: boolean;
  token?: string;
};

export type InviteResolution =
  { action: "reattach"; target: GuestBoard } | { action: "create" };

const INVITE_MARKER = "sreda-invite=";

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(text: string): string {
  const padded =
    text.replace(/-/g, "+").replace(/_/g, "/") +
    "===".slice((text.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function requiredId(value: string, label: string): string {
  if (!value.trim() || !/^[a-zA-Z0-9_-]+$/.test(value) || value.length > 100)
    throw Error("Некорректный " + label);
  return value;
}

export function createInvite(input: {
  workspaceId: string;
  hostId: string;
  boardId: string;
  role: "view" | "edit";
  url: string;
  staticDomain: boolean;
  token?: string;
}): InvitePayload {
  const url = input.url.trim();
  if (!url) throw Error("Не указан адрес приглашения");
  const token = input.token?.trim();
  if (token !== undefined && token !== "" && token.length < 43)
    throw Error("Некорректный токен приглашения");
  return {
    format: "sreda-invite",
    version: 2,
    workspaceId: requiredId(input.workspaceId, "идентификатор пространства"),
    hostId: requiredId(input.hostId, "идентификатор владельца"),
    boardId: requiredId(input.boardId, "идентификатор доски"),
    role: input.role === "view" || input.role === "edit"
      ? input.role
      : (() => { throw Error("Некорректные права доступа"); })(),
    url,
    staticDomain: !!input.staticDomain,
    ...(token ? { token } : {}),
  };
}

export function encodeInviteLink(invite: InvitePayload): string {
  const payload = createInvite(invite);
  const encoded = toBase64Url(JSON.stringify(payload));
  try {
    const base = new URL(payload.url);
    base.hash = INVITE_MARKER + encoded;
    return base.toString();
  } catch {
    const joiner = payload.url.includes("#") ? "&" : "#";
    return payload.url + joiner + INVITE_MARKER + encoded;
  }
}

function decodePayload(encoded: string): InvitePayload {
  let raw: string;
  try {
    raw = fromBase64Url(encoded);
  } catch {
    throw Error("Некорректная ссылка-приглашение");
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw Error("Некорректная ссылка-приглашение");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Некорректная ссылка-приглашение");
  const o = value as Record<string, unknown>;
  if (o.format !== "sreda-invite" || o.version !== 2)
    throw Error("Ожидалась ссылка-приглашение Среда версии 2");
  if (typeof o.url !== "string" || typeof o.staticDomain !== "boolean")
    throw Error("Некорректная ссылка-приглашение");
  if (typeof o.workspaceId !== "string" || typeof o.hostId !== "string"
    || typeof o.boardId !== "string" || (o.role !== "view" && o.role !== "edit"))
    throw Error("Некорректная ссылка-приглашение");
  if (o.token !== undefined && typeof o.token !== "string")
    throw Error("Некорректная ссылка-приглашение");
  return createInvite({
    workspaceId: o.workspaceId,
    hostId: o.hostId,
    boardId: o.boardId,
    role: o.role,
    url: o.url,
    staticDomain: o.staticDomain,
    token: typeof o.token === "string" ? o.token : undefined,
  });
}

export function parseInviteLink(input: string): InvitePayload {
  const text = input.trim();
  if (!text) throw Error("Вставьте ссылку-приглашение");
  const hashIndex = text.indexOf("#");
  if (hashIndex >= 0) {
    const hash = text.slice(hashIndex + 1);
    const params = new URLSearchParams(
      hash.startsWith(INVITE_MARKER) ? hash : hash.replace(/^#/, ""),
    );
    const fromQuery = params.get("sreda-invite");
    if (fromQuery) return decodePayload(fromQuery);
    const marker = hash.indexOf(INVITE_MARKER);
    if (marker >= 0)
      return decodePayload(hash.slice(marker + INVITE_MARKER.length));
  }
  if (/^[A-Za-z0-9_-]+$/.test(text)) return decodePayload(text);
  throw Error("Это не ссылка-приглашение Среда");
}

export function sameSharedWorkspace(
  record: Pick<GuestBoard, "workspaceId" | "hostId">,
  invite: Pick<InvitePayload, "workspaceId" | "hostId">,
): boolean {
  return (
    record.workspaceId === invite.workspaceId && record.hostId === invite.hostId
  );
}

export function resolveInvite(
  records: GuestBoard[],
  invite: InvitePayload,
): InviteResolution {
  const target = records.find(
    (record) => sameSharedWorkspace(record, invite) && record.board.id === invite.boardId,
  );
  if (target) return { action: "reattach", target };
  return { action: "create" };
}

export function applyInvite(
  records: GuestBoard[],
  invite: InvitePayload,
  hostBoard: Board,
): { records: GuestBoard[]; action: "reattach" | "create"; board: GuestBoard } {
  validateBoard(hostBoard);
  const payload = createInvite(invite);
  if (hostBoard.id !== payload.boardId)
    throw Error("Сервер прислал доску вне области приглашения");
  const next: GuestBoard = {
    workspaceId: payload.workspaceId,
    hostId: payload.hostId,
    board: structuredClone(hostBoard),
    status: "connected",
    inviteUrl: payload.url,
    staticDomain: payload.staticDomain,
    token: payload.token,
  };
  const resolution = resolveInvite(records, payload);
  if (resolution.action === "reattach") {
    const recordsNext = records.map((record) =>
      record === resolution.target ? next : record,
    );
    return { records: recordsNext, action: "reattach", board: next };
  }
  return { records: [...records, next], action: "create", board: next };
}

export function canAutoReconnect(record: GuestBoard): boolean {
  return (
    record.status === "disconnected" &&
    record.staticDomain &&
    !!record.inviteUrl.trim()
  );
}

export function disconnectedHint(record: GuestBoard): string | null {
  if (record.status !== "disconnected") return null;
  if (record.staticDomain) return null;
  return DISCONNECTED_NEW_LINK_HINT;
}

export function inviteSocketUrl(invite: InvitePayload): string {
  const url = new URL(invite.url);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = (url.pathname.replace(/\/$/, "") || "") + "/ws";
  url.search = "";
  url.hash = "";
  return url.toString();
}
