import { useEffect, useState } from "react";
import { Button } from "../components/ui/button";
import { desktop } from "../persistence";

type McpConfig = {
  enabled: boolean;
  transport: "stdio" | "http" | "both";
  port: number;
  mode: "read" | "read-write" | "confirm";
  boardIds: string[];
  folderIds: string[];
  tokenHash?: string | null;
};

type Pending = { id: string; tool: string; summary: string; createdAt: number };
type Audit = { id: string; tool: string; summary: string; createdAt: number; undone: boolean };
type Client = { id: string; transport: string; label: string; seenAt: number };

const EMPTY: McpConfig = {
  enabled: false,
  transport: "stdio",
  port: 47321,
  mode: "read",
  boardIds: [],
  folderIds: [],
};

async function readConfig(): Promise<McpConfig> {
  if (!desktop) {
    const raw = localStorage.getItem("sreda.mcp");
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<McpConfig>("mcp_config_get");
}

async function writeConfig(config: McpConfig) {
  if (!desktop) {
    localStorage.setItem("sreda.mcp", JSON.stringify(config));
    return;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("mcp_config_set", { config });
  await invoke("mcp_http_apply");
}

export function McpSettings() {
  const [config, setConfig] = useState<McpConfig>(EMPTY);
  const [token, setToken] = useState("");
  const [binary, setBinary] = useState("sreda-mcp");
  const [pending, setPending] = useState<Pending[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [copied, setCopied] = useState("");
  const refresh = async () => {
    setConfig(await readConfig());
    if (!desktop) return;
    const { invoke } = await import("@tauri-apps/api/core");
    setPending(await invoke("mcp_pending_list"));
    setAudit(await invoke("mcp_audit_list"));
    setClients(await invoke("mcp_clients"));
    setBinary(await invoke<string>("mcp_binary_path"));
  };
  useEffect(() => {
    void refresh();
  }, []);
  const save = async (next: McpConfig) => {
    setConfig(next);
    await writeConfig(next);
  };
  const snippet = (kind: "stdio" | "http") =>
    JSON.stringify(
      kind === "stdio"
        ? { mcpServers: { sreda: { command: binary } } }
        : {
            mcpServers: {
              sreda: {
                url: `http://127.0.0.1:${config.port}/mcp`,
                headers: { Authorization: "Bearer " + (token || "<токен>") },
              },
            },
          },
      null,
      2,
    );
  const copy = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
  };
  return (
    <div className="mcp-settings">
      <p className="field-hint settings-section-hint">
        Сервер выключен по умолчанию и слушает только этот компьютер. Запись идёт через ту же проверку и очередь ревизий, что и интерфейс. Удаление всегда ждёт подтверждения здесь.
      </p>
      {!desktop && <p className="field-hint">В окне браузера настройки запоминаются локально. Сам сервер запускается в приложении Windows.</p>}
      <label className="check-row">
        <input type="checkbox" checked={config.enabled} onChange={(event) => void save({ ...config, enabled: event.target.checked })} />
        <span>Включить MCP</span>
      </label>
      <label className="field">
        <span>Транспорт</span>
        <select value={config.transport} onChange={(event) => void save({ ...config, transport: event.target.value as McpConfig["transport"] })}>
          <option value="stdio">stdio — клиент запускает sreda-mcp</option>
          <option value="http">HTTP на 127.0.0.1</option>
          <option value="both">Оба</option>
        </select>
      </label>
      <label className="field">
        <span>Порт HTTP</span>
        <input
          type="number"
          min={1024}
          max={65535}
          value={config.port}
          onChange={(event) => setConfig({ ...config, port: Number(event.target.value) })}
          onBlur={() => void save(config)}
        />
      </label>
      <label className="field">
        <span>Режим доступа</span>
        <select value={config.mode} onChange={(event) => void save({ ...config, mode: event.target.value as McpConfig["mode"] })}>
          <option value="read">Только чтение</option>
          <option value="read-write">Чтение и запись</option>
          <option value="confirm">Запись с подтверждением</option>
        </select>
      </label>
      <label className="field">
        <span>Область: id досок через запятую, пусто — все</span>
        <input
          value={config.boardIds.join(", ")}
          onChange={(event) =>
            setConfig({
              ...config,
              boardIds: event.target.value.split(",").map((item) => item.trim()).filter(Boolean),
            })
          }
          onBlur={() => void save(config)}
        />
      </label>
      <label className="field">
        <span>Область: id папок документов, пусто — все</span>
        <input
          value={config.folderIds.join(", ")}
          onChange={(event) =>
            setConfig({
              ...config,
              folderIds: event.target.value.split(",").map((item) => item.trim()).filter(Boolean),
            })
          }
          onBlur={() => void save(config)}
        />
      </label>
      <div className="settings-actions">
        <Button
          type="button"
          variant="outline"
          onClick={async () => {
            if (!desktop) {
              setToken("preview-token");
              return;
            }
            const { invoke } = await import("@tauri-apps/api/core");
            const minted = await invoke<{ token: string }>("mcp_token_generate");
            setToken(minted.token);
            await refresh();
          }}
        >
          Создать токен
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={async () => {
            setToken("");
            if (!desktop) return;
            const { invoke } = await import("@tauri-apps/api/core");
            await invoke("mcp_token_revoke");
            await refresh();
          }}
        >
          Отозвать токен
        </Button>
      </div>
      {token && <p className="field-hint">Токен показан один раз: {token}</p>}
      <p className="field-hint">{config.tokenHash ? "Токен задан." : "Токена нет — HTTP не примет клиентов."}</p>
      <h3 className="settings-subhead">Скопировать конфиг</h3>
      <div className="settings-actions">
        <Button type="button" variant="outline" onClick={() => void copy(snippet("stdio"), "stdio")}>
          Claude / Cursor · stdio
        </Button>
        <Button type="button" variant="outline" onClick={() => void copy(snippet("http"), "http")}>
          HTTP
        </Button>
      </div>
      {copied && <p className="settings-saved">Скопирован конфиг {copied}</p>}
      <h3 className="settings-subhead">Подключённые клиенты</h3>
      {clients.length === 0 && <p className="field-hint">Пока никого.</p>}
      {clients.map((client) => (
        <p key={client.id} className="field-hint">
          {client.label} · {client.transport}
        </p>
      ))}
      <h3 className="settings-subhead">Ждут подтверждения</h3>
      {pending.map((item) => (
        <div key={item.id} className="settings-actions">
          <span>{item.summary}</span>
          <Button
            type="button"
            onClick={async () => {
              const { invoke } = await import("@tauri-apps/api/core");
              await invoke("mcp_pending_resolve", { id: item.id, accept: true });
              await refresh();
            }}
          >
            Подтвердить
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              const { invoke } = await import("@tauri-apps/api/core");
              await invoke("mcp_pending_resolve", { id: item.id, accept: false });
              await refresh();
            }}
          >
            Отклонить
          </Button>
        </div>
      ))}
      <h3 className="settings-subhead">Журнал ИИ</h3>
      {audit.map((item) => (
        <div key={item.id} className="settings-actions">
          <span>{item.undone ? "Отменено · " : ""}{item.summary}</span>
          {!item.undone && (
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                const { invoke } = await import("@tauri-apps/api/core");
                await invoke("mcp_audit_undo", { id: item.id });
                await refresh();
                window.dispatchEvent(new Event("sreda-workspace-changed"));
              }}
            >
              Отменить
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
