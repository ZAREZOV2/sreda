import { useMemo, useState } from "react";
import { Button } from "../components/ui/button";
import {
  BUILTIN_THEMES,
  applyTheme,
  loadUserThemes,
  parseTheme,
  saveUserTheme,
  type SredaTheme,
  type ThemeRecord,
} from "../theme";
import { contrastWarnings, formatRatio, parseHexColor } from "../themeContrast";

export function ThemeEditor({
  currentKey,
  onCreated,
}: {
  currentKey: string;
  onCreated: (record: ThemeRecord) => void;
}) {
  const [base, setBase] = useState<SredaTheme | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [name, setName] = useState("Моя тема");
  const [error, setError] = useState("");
  const warnings = useMemo(() => contrastWarnings(draft), [draft]);
  const start = async () => {
    const users = await loadUserThemes();
    const found = [...BUILTIN_THEMES, ...users].find((record) =>
      (record.source === "builtin" ? record.id : "user:" + record.id) === currentKey,
    );
    const theme = found?.theme ?? BUILTIN_THEMES[0].theme;
    setBase(theme);
    setDraft({ ...theme.tokens });
    setName(theme.name + " · копия");
    setError("");
  };
  if (!base) {
    return (
      <div className="settings-actions">
        <Button type="button" variant="outline" onClick={() => void start()}>
          Редактор на основе текущей
        </Button>
      </div>
    );
  }
  const entries = Object.entries(draft);
  return (
    <div className="theme-editor">
      <h3 className="settings-subhead">Редактор темы</h3>
      <p className="field-hint">Копия темы «{base.name}». Сохраняются только известные токены, без url() и @import.</p>
      <label className="field">
        <span>Название</span>
        <input value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
      </label>
      <div className="token-grid">
        {entries.map(([token, value]) => (
          <label key={token} className="token-row">
            <span>{token}</span>
            {parseHexColor(value) && (
              <input
                type="color"
                aria-label={"Цвет " + token}
                value={value.length === 4 ? expand(value) : value}
                onChange={(event) => setDraft({ ...draft, [token]: event.target.value })}
              />
            )}
            <input
              value={value}
              onChange={(event) => setDraft({ ...draft, [token]: event.target.value })}
            />
          </label>
        ))}
      </div>
      {warnings.length > 0 && (
        <ul className="contrast-list">
          {warnings.map((warning) => (
            <li key={warning.foreground + warning.background}>
              {warning.label}: {formatRatio(warning.ratio)} при норме {warning.minimum}:1
            </li>
          ))}
        </ul>
      )}
      {error && <p className="field-error">{error}</p>}
      <div className="settings-actions">
        <Button
          type="button"
          onClick={() => {
            const theme: SredaTheme = {
              name: name.trim() || "Моя тема",
              version: "1.0.0",
              base: base.base,
              author: "Локально",
              tokens: draft,
            };
            const parsed = parseTheme(theme);
            if (!parsed.ok) {
              setError(parsed.errors.map((item) => item.message).join("; "));
              return;
            }
            applyTheme(parsed.theme);
            void saveUserTheme(parsed.theme).then((filename) => {
              onCreated({ source: "user", id: filename, theme: parsed.theme });
              setError("");
            }).catch((reason) => setError(String(reason)));
          }}
        >
          Сохранить тему
        </Button>
        <Button type="button" variant="outline" onClick={() => setBase(null)}>
          Закрыть редактор
        </Button>
      </div>
    </div>
  );
}

function expand(value: string) {
  const hex = value.slice(1);
  return "#" + hex.split("").map((char) => char + char).join("");
}
