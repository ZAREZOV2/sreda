import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  emptyWorkspace,
  parseBackupOrBoard,
  parseBoardFile,
  validateWorkspace,
  workspaceBackup,
} from "./model";
import type { BoardFile, Snapshot, Workspace, WorkspaceBackup } from "./model";
function isWorkspaceBackup(
  value: Workspace | WorkspaceBackup,
): value is WorkspaceBackup {
  return "format" in value && value.format === "sreda-backup";
}

export const desktop = isTauri();
// The HTML preview is deliberately ephemeral; only the desktop build persists to SQLite.
let preview: Snapshot = { revision: 0, workspace: emptyWorkspace() };
export async function loadWorkspace(): Promise<Snapshot> {
  const value = desktop
    ? await invoke<Snapshot>("load_workspace")
    : structuredClone(preview);
  validateWorkspace(value.workspace);
  if (!Number.isSafeInteger(value.revision) || value.revision < 0)
    throw Error("Некорректная версия данных");
  return value;
}
export async function saveWorkspace(
  workspace: Workspace,
  expectedRevision: number,
): Promise<number> {
  validateWorkspace(workspace);
  if (desktop)
    return invoke<number>("save_workspace", { workspace, expectedRevision });
  if (expectedRevision !== preview.revision) throw Error("Конфликт версий");
  preview = {
    workspace: structuredClone(workspace),
    revision: expectedRevision + 1,
  };
  return preview.revision;
}
export async function location(): Promise<string> {
  return desktop
    ? invoke<string>("data_location")
    : "HTML-просмотр: данные хранятся только до закрытия страницы";
}
export async function exportBoard(file: BoardFile): Promise<boolean> {
  if (desktop) return invoke<boolean>("export_board", { file });
  const blob = new Blob([JSON.stringify(file, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "sreda-board.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
export async function importBoard(): Promise<BoardFile | null> {
  if (!desktop) throw Error("Импорт доступен в Windows-приложении.");
  const file = await invoke<unknown>("import_board");
  return file === null ? null : parseBoardFile(file);
}

export async function dataDir(): Promise<string> {
  if (desktop)
    return invoke<string>("data_dir_path");
  return location();
}

export async function defaultDisplayName(): Promise<string> {
  if (!desktop) return "Вы";
  try {
    const name = await invoke<string>("default_display_name");
    return name.trim() || "Вы";
  } catch {
    return "Вы";
  }
}

export async function openDataDir(): Promise<boolean> {
  if (!desktop) return false;
  try {
    await invoke("open_data_dir");
    return true;
  } catch {
    return false;
  }
}

export async function openExternalUrl(url: string): Promise<boolean> {
  if (!desktop) {
    window.open(url, "_blank", "noopener,noreferrer");
    return true;
  }
  try {
    await invoke("open_external_url", { url });
    return true;
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
    return true;
  }
}

export async function exportWorkspaceBackup(
  workspace: Workspace | WorkspaceBackup,
): Promise<boolean> {
  const file = isWorkspaceBackup(workspace)
    ? workspace
    : workspaceBackup(workspace);
  if (desktop) return invoke<boolean>("export_workspace_backup", { file });
  const blob = new Blob([JSON.stringify(file, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "sreda-backup.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

export async function importBackupOrBoard(): Promise<
  | { kind: "backup"; file: WorkspaceBackup }
  | { kind: "board"; file: BoardFile }
  | null
> {
  if (!desktop) throw Error("Импорт доступен в Windows-приложении.");
  const value = await invoke<unknown>("import_workspace_backup");
  return value === null ? null : parseBackupOrBoard(value);
}

