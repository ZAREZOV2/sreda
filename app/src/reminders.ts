export type Remindable = {
  id: string;
  title: string;
  reminderAt?: number | null;
};

export function reminderKey(task: Remindable): string {
  return task.id + ":" + String(task.reminderAt ?? "");
}

export function dueReminders(
  tasks: Remindable[],
  now: number,
  fired: ReadonlySet<string>,
): Remindable[] {
  return tasks.filter((task) => {
    if (typeof task.reminderAt !== "number" || !Number.isFinite(task.reminderAt))
      return false;
    if (task.reminderAt > now) return false;
    return !fired.has(reminderKey(task));
  });
}
