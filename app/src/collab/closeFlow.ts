import { importCopy } from "../model.ts";
import type { Board, Workspace } from "../model.ts";
import {
  applyInvite,
  type GuestBoard,
  type InvitePayload,
} from "../share.ts";

export type CloseDecision = "save-local" | "keep-disconnected";

export type CloseResult = {
  records: GuestBoard[];
  localCopies: Board[];
};

export function applyHostClosed(
  records: GuestBoard[],
  invite: Pick<InvitePayload, "workspaceId" | "hostId">,
  workspace: Workspace | null,
  decision: CloseDecision,
): CloseResult {
  const match = (record: GuestBoard) =>
    record.workspaceId === invite.workspaceId && record.hostId === invite.hostId;
  if (decision === "save-local") {
    const fallbackBoard = records.find(match)?.board;
    const localCopies = workspace
      ? workspace.boards.map((board) => importCopy({ format: "sreda-board", version: 1, board }))
      : fallbackBoard
        ? [importCopy({ format: "sreda-board", version: 1, board: fallbackBoard })]
        : [];
    return { records: records.filter((record) => !match(record)), localCopies };
  }
  return {
    records: records.map((record) =>
      match(record) ? { ...record, status: "disconnected" as const } : record,
    ),
    localCopies: [],
  };
}

export function reattachOrCreate(
  records: GuestBoard[],
  invite: InvitePayload,
  board: Board,
) {
  return applyInvite(records, invite, board);
}
