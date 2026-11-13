import { applyAction } from "./model.ts";
import type { Action, Snapshot, Workspace } from "./model.ts";
export type Command = Action | ((state: Workspace) => Action);
export type Commit = (command: Command) => Promise<boolean>;
export function createCommandQueue(options: {
  get: () => Snapshot;
  confirmed: (snapshot: Snapshot) => void;
  save: (workspace: Workspace, revision: number) => Promise<number>;
  pending: (delta: number) => void;
  error: (message: string) => void;
}) {
  let tail = Promise.resolve();
  const commit: Commit = (command) => {
    options.pending(1);
    let success = false;
    const job = tail.then(async () => {
      try {
        const before = options.get();
        const action =
          typeof command === "function" ? command(before.workspace) : command;
        const workspace = applyAction(before.workspace, action);
        if (JSON.stringify(workspace) !== JSON.stringify(before.workspace)) {
          const revision = await options.save(workspace, before.revision);
          options.confirmed({ revision, workspace });
        }
        options.error("");
        success = true;
      } catch (error) {
        options.error(String(error));
      } finally {
        options.pending(-1);
      }
    });
    tail = job.catch(() => {});
    return job.then(() => success);
  };
  return { commit, idle: () => tail };
}
