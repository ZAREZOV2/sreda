import type { Snapshot, Workspace } from "../model.ts";
import type { InvitePayload } from "../share.ts";

export type Participant = {
  id: string;
  name: string;
  selectedBoardId: string | null;
  role: string;
  color?: string;
};

export type CollabStatus =
  | "idle"
  | "connecting"
  | "online"
  | "disconnected"
  | "closed";

export type CollabState = {
  status: CollabStatus;
  role: "host" | "guest" | null;
  snapshot: Snapshot | null;
  participants: Participant[];
  selfId: string;
  workspaceId: string;
  hostId: string;
  staticDomain: boolean;
  invite: InvitePayload | null;
  error: string;
  hostClosed: boolean;
  reconnectAttempt: number;
};

export const initialCollabState = (): CollabState => ({
  status: "idle",
  role: null,
  snapshot: null,
  participants: [],
  selfId: "",
  workspaceId: "",
  hostId: "",
  staticDomain: false,
  invite: null,
  error: "",
  hostClosed: false,
  reconnectAttempt: 0,
});

export type CollabEvent =
  | { type: "connecting"; invite: InvitePayload; role?: "host" | "guest" }
  | {
      type: "welcome";
      snapshot: Snapshot;
      selfId: string;
      workspaceId: string;
      hostId: string;
      staticDomain: boolean;
      participants: Participant[];
    }
  | {
      type: "state";
      revision: number;
      workspace: Workspace;
      originId: string;
    }
  | { type: "rejected"; expectedRevision: number; message: string; snapshot: Snapshot }
  | { type: "presence"; participants: Participant[] }
  | { type: "disconnected"; error?: string }
  | { type: "host_closed"; reason?: string }
  | { type: "hosting"; snapshot: Snapshot; workspaceId: string; hostId: string; staticDomain: boolean }
  | { type: "stopped" }
  | { type: "clear_closed" }
  | { type: "reconnect_tick" };

export function reduceCollab(state: CollabState, event: CollabEvent): CollabState {
  switch (event.type) {
    case "connecting":
      return {
        ...state,
        status: "connecting",
        role: event.role ?? "guest",
        invite: event.invite,
        error: "",
        hostClosed: false,
      };
    case "welcome":
      return {
        ...state,
        status: "online",
        role: "guest",
        snapshot: event.snapshot,
        selfId: event.selfId,
        workspaceId: event.workspaceId,
        hostId: event.hostId,
        staticDomain: event.staticDomain,
        participants: event.participants,
        error: "",
        hostClosed: false,
        reconnectAttempt: 0,
      };
    case "hosting":
      return {
        ...state,
        status: "online",
        role: "host",
        snapshot: event.snapshot,
        workspaceId: event.workspaceId,
        hostId: event.hostId,
        staticDomain: event.staticDomain,
        error: "",
        hostClosed: false,
      };
    case "state":
      return {
        ...state,
        snapshot: { revision: event.revision, workspace: event.workspace },
        error: "",
      };
    case "rejected":
      return {
        ...state,
        snapshot: event.snapshot,
        error: event.message,
      };
    case "presence":
      return { ...state, participants: event.participants };
    case "disconnected":
      return {
        ...state,
        status: state.hostClosed ? "closed" : "disconnected",
        error: event.error ?? state.error,
        reconnectAttempt: state.staticDomain
          ? state.reconnectAttempt + 1
          : state.reconnectAttempt,
      };
    case "host_closed":
      return {
        ...state,
        status: "closed",
        hostClosed: true,
        error: "",
      };
    case "stopped":
      return {
        ...initialCollabState(),
        snapshot: state.role === "host" ? state.snapshot : initialCollabState().snapshot,
      };
    case "clear_closed":
      return { ...state, hostClosed: false, status: "disconnected" };
    case "reconnect_tick":
      return { ...state, reconnectAttempt: state.reconnectAttempt + 1 };
    default:
      return state;
  }
}

export function nextBackoffMs(attempt: number): number {
  const step = Math.min(15_000, 500 * 2 ** Math.max(0, attempt));
  return step;
}

export function shouldAutoReconnect(state: CollabState): boolean {
  return (
    state.role === "guest" &&
    state.status === "disconnected" &&
    state.staticDomain &&
    !state.hostClosed &&
    !!state.invite
  );
}
