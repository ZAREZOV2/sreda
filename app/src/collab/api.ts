import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Snapshot, Workspace } from "../model.ts";
import type { GuestBoard } from "../share.ts";
import type { Participant } from "./reducer.ts";

export type ShareSettings = {
  ngrokAuthtoken: string;
  staticDomain: string;
};

export type HostStatus = {
  running: boolean;
  publicUrl?: string | null;
  inviteLink?: string | null;
  staticDomain: boolean;
  workspaceId?: string | null;
  hostId?: string | null;
  participants: Participant[];
};

const GUEST_KEY = "sreda-guest-sessions";

export async function settingsGet(): Promise<ShareSettings> {
  if (!isTauri()) return { ngrokAuthtoken: "", staticDomain: "" };
  return invoke<ShareSettings>("collab_settings_get");
}

export async function settingsSet(settings: ShareSettings): Promise<void> {
  if (!isTauri()) return;
  await invoke("collab_settings_set", { settings });
}

export async function hostStatus(): Promise<HostStatus> {
  if (!isTauri())
    return { running: false, staticDomain: false, participants: [] };
  return invoke<HostStatus>("collab_host_status");
}

export async function hostStart(): Promise<HostStatus> {
  if (!isTauri()) throw Error("Совместная работа доступна в приложении Среда.");
  return invoke<HostStatus>("collab_host_start");
}

export async function hostStop(): Promise<void> {
  if (!isTauri()) return;
  await invoke("collab_host_stop");
}

export async function hostSetProfile(
  name: string,
  color: string,
): Promise<void> {
  if (!isTauri()) return;
  await invoke("collab_host_set_profile", { profile: { name, color } });
}

export async function inviteIssue(): Promise<string> {
  return invoke<string>("collab_invite_issue");
}

export async function inviteRevoke(): Promise<string> {
  return invoke<string>("collab_invite_revoke");
}

export async function hostPush(
  workspace: Workspace,
  expectedRevision: number,
): Promise<number> {
  return invoke<number>("collab_host_push", { workspace, expectedRevision });
}

export async function loadGuestSessions(): Promise<GuestBoard[]> {
  if (!isTauri()) {
    try {
      const raw = localStorage.getItem(GUEST_KEY);
      return raw ? (JSON.parse(raw) as GuestBoard[]) : [];
    } catch {
      return [];
    }
  }
  const value = await invoke<unknown>("guest_sessions_load");
  return Array.isArray(value) ? (value as GuestBoard[]) : [];
}

export async function saveGuestSessions(sessions: GuestBoard[]): Promise<void> {
  if (!isTauri()) {
    localStorage.setItem(GUEST_KEY, JSON.stringify(sessions));
    return;
  }
  await invoke("guest_sessions_save", { sessions });
}

export async function shareTheme(theme: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("collab_share_theme", { theme });
}

export async function listenHostEvents(handlers: {
  onState?: (payload: { snapshot: Snapshot; originId: string }) => void;
  onPresence?: (participants: Participant[]) => void;
  onStopped?: () => void;
  onTheme?: (theme: string) => void;
}): Promise<() => void> {
  if (!isTauri()) return () => {};
  const stops: UnlistenFn[] = [];
  if (handlers.onState)
    stops.push(
      await listen<{ snapshot: Snapshot; originId: string }>(
        "collab://state",
        (event) => handlers.onState?.(event.payload),
      ),
    );
  if (handlers.onPresence)
    stops.push(
      await listen<Participant[]>("collab://presence", (event) =>
        handlers.onPresence?.(event.payload),
      ),
    );
  if (handlers.onStopped)
    stops.push(
      await listen("collab://stopped", () => handlers.onStopped?.()),
    );
  if (handlers.onTheme)
    stops.push(
      await listen<{ theme: string }>("collab://theme", (event) =>
        handlers.onTheme?.(event.payload.theme),
      ),
    );
  return () => {
    for (const stop of stops) stop();
  };
}
