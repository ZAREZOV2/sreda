import { useEffect, useState } from "react";
import { Button } from "./components/ui/button";

type Phase = "focus" | "break";
type Session = {
  taskId: string;
  title: string;
  phase: Phase;
  endsAt: number;
  running: boolean;
  logged: boolean;
};

let session: Session | null = null;
const listeners = new Set<() => void>();
function publish() {
  for (const listener of listeners) listener();
}

export function startFocus(taskId: string, title: string, minutes = 25) {
  session = {
    taskId,
    title,
    phase: "focus",
    endsAt: Date.now() + minutes * 60_000,
    running: true,
    logged: false,
  };
  publish();
}

export function FocusTimer({
  taskId,
  title,
  onComplete,
}: {
  taskId?: string;
  title?: string;
  onComplete?: (ms: number) => void;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const listener = () => setTick((value) => value + 1);
    listeners.add(listener);
    const timer = setInterval(listener, 1000);
    return () => {
      listeners.delete(listener);
      clearInterval(timer);
    };
  }, []);
  const current = session && (!taskId || session.taskId === taskId) ? session : taskId ? null : session;
  if (!current && taskId) {
    return (
      <div className="focus-box">
        <strong>Фокус</strong>
        <div className="settings-actions">
          <Button type="button" variant="outline" onClick={() => startFocus(taskId, title || "Задача", 25)}>
            25 мин
          </Button>
          <Button type="button" variant="outline" onClick={() => startFocus(taskId, title || "Задача", 5)}>
            5 мин
          </Button>
        </div>
      </div>
    );
  }
  if (!current) return null;
  const left = Math.max(0, current.endsAt - Date.now());
  useEffect(() => {
    if (left !== 0 || !current.running || current.phase !== "focus" || current.logged) return;
    current.logged = true;
    current.running = false;
    onComplete?.(25 * 60_000);
    void notify("Фокус завершён", current.title);
    publish();
  }, [left, current, onComplete]);
  const minutes = Math.floor(left / 60_000);
  const seconds = Math.floor((left % 60_000) / 1000);
  return (
    <div className={"focus-box" + (taskId ? "" : " is-floating")} role="timer">
      <strong>{current.phase === "focus" ? "Фокус" : "Перерыв"} · {current.title}</strong>
      <span>
        {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
      </span>
      <div className="settings-actions">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            if (!session) return;
            if (session.running) {
              session.endsAt = Date.now() + left;
              session.running = false;
            } else {
              session.endsAt = Date.now() + left;
              session.running = true;
            }
            publish();
          }}
        >
          {current.running ? "Пауза" : "Дальше"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            session = null;
            publish();
          }}
        >
          Стоп
        </Button>
      </div>
    </div>
  );
}

export async function notify(title: string, body: string) {
  try {
    const { invoke, isTauri } = await import("@tauri-apps/api/core");
    if (isTauri()) {
      await invoke("notify_user", { title, body });
      return;
    }
  } catch {
    /* browser fallback */
  }
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body });
  }
}
