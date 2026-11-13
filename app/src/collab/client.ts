import type { Snapshot, Workspace } from "../model.ts";
import {
  inviteSocketUrl,
  type InvitePayload,
} from "../share.ts";
import type { CollabEvent, Participant } from "./reducer.ts";

export type CollabClientHandlers = {
  dispatch: (event: CollabEvent) => void;
};

export function createGuestId(): string {
  return "guest_" + crypto.randomUUID().replace(/-/g, "");
}

export class CollabClient {
  private socket: WebSocket | null = null;
  private closedByUs = false;
  constructor(private handlers: CollabClientHandlers) {}

  connect(
    invite: InvitePayload,
    name: string,
    guestId = createGuestId(),
    color?: string,
  ) {
    this.disconnect();
    this.closedByUs = false;
    this.handlers.dispatch({ type: "connecting", invite, role: "guest" });
    if (!invite.token) {
      this.handlers.dispatch({
        type: "disconnected",
        error: "В ссылке нет токена приглашения",
      });
      return;
    }
    const url = inviteSocketUrl(invite);
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          type: "hello",
          token: invite.token,
          guestId,
          name,
          color,
        }),
      );
    };
    socket.onmessage = (event) => {
      let message: { type?: string; [key: string]: unknown };
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      this.handlers.dispatch(this.toEvent(message, invite));
    };
    socket.onerror = () => {
      if (!this.closedByUs)
        this.handlers.dispatch({
          type: "disconnected",
          error: "Не удалось подключиться к узлу",
        });
    };
    socket.onclose = () => {
      if (!this.closedByUs)
        this.handlers.dispatch({ type: "disconnected" });
    };
  }

  push(workspace: Workspace, expectedRevision: number) {
    this.socket?.send(
      JSON.stringify({ type: "push", expectedRevision, workspace }),
    );
  }

  presence(name: string, selectedBoardId: string | null, color?: string) {
    this.socket?.send(
      JSON.stringify({ type: "presence", name, selectedBoardId, color }),
    );
  }

  heartbeat() {
    this.socket?.send(JSON.stringify({ type: "heartbeat" }));
  }

  disconnect() {
    this.closedByUs = true;
    this.socket?.close();
    this.socket = null;
  }

  private toEvent(
    message: { type?: string; [key: string]: unknown },
    invite: InvitePayload,
  ): CollabEvent {
    switch (message.type) {
      case "welcome":
        return {
          type: "welcome",
          snapshot: message.snapshot as Snapshot,
          selfId: String(message.selfId ?? ""),
          workspaceId: String(message.workspaceId ?? invite.workspaceId),
          hostId: String(message.hostId ?? invite.hostId),
          staticDomain: Boolean(message.staticDomain ?? invite.staticDomain),
          participants: (message.participants as Participant[]) ?? [],
        };
      case "state":
        return {
          type: "state",
          revision: Number(message.revision),
          workspace: message.workspace as Workspace,
          originId: String(message.originId ?? ""),
        };
      case "rejected":
        return {
          type: "rejected",
          expectedRevision: Number(message.expectedRevision),
          message: String(message.message ?? "Отклонено"),
          snapshot: message.snapshot as Snapshot,
        };
      case "presence":
        return {
          type: "presence",
          participants: (message.participants as Participant[]) ?? [],
        };
      case "shutdown":
        return {
          type: "host_closed",
          reason: String(message.reason ?? "closed"),
        };
      case "error":
        return {
          type: "disconnected",
          error: String(message.message ?? "Ошибка узла"),
        };
      case "theme":
        return { type: "theme", theme: String(message.theme ?? "") };
      default:
        return { type: "disconnected" };
    }
  }
}
