import { useEffect, useState } from "react";
import packageInfo from "../package.json" with { type: "json" };
import * as Dialog from "@radix-ui/react-dialog";
import {
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  Palette,
  Settings as SettingsIcon,
  Share2,
  Sparkles,
  Upload,
  User,
  Info,
  Database,
  X,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { FieldLabel } from "./components/FieldLabel";
import { BrandMark } from "./BrandMark";
import { ThemePicker } from "./ThemePicker";
import {
  hasFieldErrors,
  validateShareSettings,
  type ShareFieldErrors,
} from "./collab/validate";
import type { ShareSettings } from "./collab/SharePanel";
import type { ThemeRecord } from "./theme";
import {
  PROFILE_COLOR_NAMES,
  PROFILE_COLORS,
  initials,
  validateDisplayName,
  type Profile,
} from "./profile";
import notices from "../THIRD-PARTY-NOTICES.txt?raw";
import { McpSettings } from "./settings/McpSettings";
import { ThemeEditor } from "./settings/ThemeEditor";
import { UpdatesPanel } from "./settings/UpdatesPanel";

export type SettingsSection =
  | "profile"
  | "appearance"
  | "collab"
  | "ai"
  | "data"
  | "updates"
  | "about";

function onOpenAutoFocus(event: Event) {
  event.preventDefault();
  const root = event.currentTarget as HTMLElement | null;
  root
    ?.querySelector<HTMLElement>(
      ".settings-panel input:not([type='hidden']):not([disabled]), .settings-panel textarea, .settings-panel button",
    )
    ?.focus();
}

const nav: {
  id: SettingsSection;
  label: string;
  icon: typeof User;
}[] = [
  { id: "profile", label: "Профиль", icon: User },
  { id: "appearance", label: "Оформление", icon: Palette },
  { id: "collab", label: "Совместная работа", icon: Share2 },
  { id: "ai", label: "ИИ / MCP", icon: Sparkles },
  { id: "data", label: "Данные", icon: Database },
  { id: "updates", label: "Обновления", icon: Download },
  { id: "about", label: "О программе", icon: Info },
];

export function SettingsDialog({
  open,
  onOpenChange,
  section,
  onSectionChange,
  profile,
  onSaveProfile,
  themeKey,
  onSelectTheme,
  shareSettings,
  onShareSettings,
  onPersistShareSettings,
  dataPath,
  databasePath,
  onOpenDataDir,
  onCopyPath,
  onExportBackup,
  onImportBackup,
  onOpenNgrokDashboard,
  onShareTheme,
  busy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  profile: Profile;
  onSaveProfile: (profile: Profile) => Promise<void> | void;
  themeKey: string;
  onSelectTheme: (record: ThemeRecord) => void;
  shareSettings: ShareSettings;
  onShareSettings: (settings: ShareSettings) => void;
  onPersistShareSettings: (settings: ShareSettings) => Promise<void> | void;
  dataPath: string;
  databasePath: string;
  onOpenDataDir: () => Promise<void> | void;
  onCopyPath: () => Promise<void> | void;
  onExportBackup: () => Promise<void> | void;
  onImportBackup: () => Promise<void> | void;
  onOpenNgrokDashboard: () => Promise<void> | void;
  onShareTheme?: () => Promise<void> | void;
  busy?: boolean;
}) {
  const [draft, setDraft] = useState(profile.displayName);
  const [nameError, setNameError] = useState<string | undefined>();
  const [fieldErrors, setFieldErrors] = useState<ShareFieldErrors>({});
  const [showToken, setShowToken] = useState(false);
  const [noticesOpen, setNoticesOpen] = useState(false);
  const [saved, setSaved] = useState("");

  useEffect(() => {
    if (open) {
      setDraft(profile.displayName);
      setNameError(undefined);
      setFieldErrors({});
      setShowToken(false);
      setNoticesOpen(false);
      setSaved("");
    }
  }, [open, profile.displayName]);

  const persistName = async (value: string) => {
    const error = validateDisplayName(value);
    setNameError(error);
    if (error) return;
    const name = value.trim();
    if (name === profile.displayName) return;
    await onSaveProfile({ ...profile, displayName: name });
    setSaved("Имя сохранено");
  };

  const persistColor = async (color: Profile["color"]) => {
    if (color === profile.color) return;
    const name = (draft.trim() || profile.displayName).trim();
    if (validateDisplayName(name)) return;
    await onSaveProfile({ displayName: name, color });
    setSaved("Цвет сохранён");
  };

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(""), 2000);
    return () => clearTimeout(timer);
  }, [saved]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="info-dialog settings-dialog"
          onOpenAutoFocus={onOpenAutoFocus}
          aria-describedby="settings-lead"
        >
          <aside className="settings-nav" aria-label="Разделы настроек">
            <div className="settings-nav-head">
              <SettingsIcon size={16} aria-hidden />
              <Dialog.Title>Настройки</Dialog.Title>
            </div>
            {nav.map((item) => {
              const Icon = item.icon;
              const current = section === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={"settings-nav-item" + (current ? " is-current" : "")}
                  aria-current={current ? "page" : undefined}
                  onClick={() => onSectionChange(item.id)}
                >
                  <Icon size={15} aria-hidden />
                  {item.label}
                </button>
              );
            })}
          </aside>
          <div className="settings-main">
            <div className="settings-main-head">
              <Dialog.Description id="settings-lead" className="settings-lead">
                {section === "profile" &&
                  "Имя и цвет аватара видны вам в боковом меню и другим участникам при совместной работе."}
                {section === "appearance" &&
                  "Тема меняется сразу на доске и запоминается на этом устройстве."}
                {section === "collab" &&
                  "Токен и домен ngrok нужны, чтобы открыть доступ к доске через интернет. Те же значения использует панель «Поделиться»."}
                {section === "data" &&
                  "Доски и документы хранятся только на этом компьютере. Резервная копия забирает их в один файл."}
                {section === "ai" &&
                  "Локальный MCP-сервер для ИИ-клиентов. По умолчанию выключен и только для чтения."}
                {section === "updates" &&
                  "Что изменилось в «Среде». Сверху — последняя версия."}
                {section === "about" &&
                  "Среда — локальные канбан-доски с совместной работой по ссылке."}
              </Dialog.Description>
              <Dialog.Close asChild>
                <Button variant="ghost" size="icon" aria-label="Закрыть">
                  <X size={16} />
                </Button>
              </Dialog.Close>
            </div>
            <div className="settings-panel">
              {section === "profile" && (
                <>
                  <div className="settings-profile-preview">
                    <span
                      className={"user-avatar is-large color-" + profile.color}
                    >
                      {initials(draft.trim() || profile.displayName)}
                    </span>
                    <div>
                      <strong>{draft.trim() || profile.displayName}</strong>
                      <small>Локальный профиль</small>
                    </div>
                  </div>
                  <label className="field">
                    <FieldLabel required>Отображаемое имя</FieldLabel>
                    <input
                      value={draft}
                      maxLength={40}
                      aria-invalid={!!nameError}
                      onChange={(e) => {
                        setDraft(e.target.value);
                        setNameError(undefined);
                      }}
                      onBlur={() => void persistName(draft)}
                      placeholder="Как вас представлять"
                    />
                    <span className="field-hint">
                      Так вас увидят гости, когда вы откроете доступ, и так вы
                      представитесь, подключаясь по ссылке.
                    </span>
                    {nameError && (
                      <span className="field-error" role="alert">
                        {nameError}
                      </span>
                    )}
                  </label>
                  <fieldset className="color-picker">
                    <legend>
                      <FieldLabel>Цвет аватара</FieldLabel>
                    </legend>
                    <div className="color-picker-row">
                      {PROFILE_COLORS.map((color) => (
                        <button
                          key={color}
                          type="button"
                          className={
                            "color-choice color-" +
                            color +
                            (profile.color === color ? " selected" : "")
                          }
                          title={PROFILE_COLOR_NAMES[color]}
                          aria-label={PROFILE_COLOR_NAMES[color]}
                          aria-pressed={profile.color === color}
                          onClick={() => void persistColor(color)}
                        >
                          {profile.color === color && <Check size={14} />}
                        </button>
                      ))}
                    </div>
                    <span className="field-hint">
                      Цвета из палитры оформления. Инициалы берутся из имени.
                    </span>
                  </fieldset>
                  {saved && <p className="settings-saved">{saved}</p>}
                </>
              )}
              {section === "appearance" && (
                <>
                  <p className="field-hint settings-section-hint">
                    Выберите стартовую тему или импортируйте файл «*.sreda-theme.json». Перед применением файл
                    проверяется по схеме, опасный CSS отбрасывается.
                  </p>
                  <ThemePicker
                    open={open}
                    onOpenChange={onOpenChange}
                    currentKey={themeKey}
                    onSelect={onSelectTheme}
                    embedded
                  />
                  <ThemeEditor currentKey={themeKey} onCreated={onSelectTheme} />
                  {onShareTheme && (
                    <div className="settings-actions">
                      <Button type="button" variant="outline" onClick={() => void onShareTheme()}>
                        Поделиться темой с участниками
                      </Button>
                    </div>
                  )}
                </>
              )}
              {section === "ai" && <McpSettings />}
              {section === "updates" && <UpdatesPanel />}
              {section === "collab" && (
                <>
                  <label className="field">
                    <FieldLabel optional>Токен ngrok</FieldLabel>
                    <div className="field-with-action">
                      <input
                        type={showToken ? "text" : "password"}
                        autoComplete="off"
                        spellCheck={false}
                        value={shareSettings.ngrokAuthtoken}
                        aria-invalid={!!fieldErrors.token}
                        onChange={(e) => {
                          onShareSettings({
                            ...shareSettings,
                            ngrokAuthtoken: e.target.value,
                          });
                          setFieldErrors((current) => ({
                            ...current,
                            token: undefined,
                          }));
                        }}
                        onBlur={(e) => {
                          const next = {
                            ...shareSettings,
                            ngrokAuthtoken: e.target.value,
                          };
                          const errors = validateShareSettings(next);
                          setFieldErrors(errors);
                          if (!hasFieldErrors(errors))
                            void onPersistShareSettings(next);
                        }}
                        placeholder="ngrok_xxxxxxxxxxxxxxxx"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={
                          showToken ? "Скрыть токен" : "Показать токен"
                        }
                        title={showToken ? "Скрыть токен" : "Показать токен"}
                        onClick={() => setShowToken((value) => !value)}
                      >
                        {showToken ? <EyeOff size={15} /> : <Eye size={15} />}
                      </Button>
                    </div>
                    <span className="field-hint">
                      Токен из кабинета ngrok нужен, чтобы открыть доступ через
                      интернет. Без него узел доступен только на этом компьютере.{" "}
                      <button
                        type="button"
                        className="text-link"
                        onClick={() => void onOpenNgrokDashboard()}
                      >
                        dashboard.ngrok.com
                      </button>
                    </span>
                    {fieldErrors.token && (
                      <span className="field-error" role="alert">
                        {fieldErrors.token}
                      </span>
                    )}
                  </label>
                  <label className="field">
                    <FieldLabel optional>Статический домен</FieldLabel>
                    <input
                      spellCheck={false}
                      value={shareSettings.staticDomain}
                      aria-invalid={!!fieldErrors.staticDomain}
                      onChange={(e) => {
                        onShareSettings({
                          ...shareSettings,
                          staticDomain: e.target.value,
                        });
                        setFieldErrors((current) => ({
                          ...current,
                          staticDomain: undefined,
                        }));
                      }}
                      onBlur={(e) => {
                        const next = {
                          ...shareSettings,
                          staticDomain: e.target.value,
                        };
                        const errors = validateShareSettings(next);
                        setFieldErrors(errors);
                        if (!hasFieldErrors(errors))
                          void onPersistShareSettings(next);
                      }}
                      placeholder="sreda.ngrok.app"
                    />
                    <span className="field-hint">
                      Постоянный адрес: ссылка-приглашение не меняется после
                      перезапуска. На ngrok статический домен есть в бесплатном
                      тарифе.
                    </span>
                    {fieldErrors.staticDomain && (
                      <span className="field-error" role="alert">
                        {fieldErrors.staticDomain}
                      </span>
                    )}
                  </label>
                </>
              )}
              {section === "data" && (
                <>
                  <label className="field">
                    <FieldLabel>Папка данных</FieldLabel>
                    <div className="field-with-action">
                      <input readOnly value={dataPath} title={dataPath} />
                    </div>
                    <span className="field-hint">
                      Здесь лежат база досок, профиль, темы и настройки узла.
                      {databasePath && dataPath !== databasePath
                        ? " Файл базы: " + databasePath + "."
                        : ""}
                    </span>
                  </label>
                  <div className="settings-actions">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void onOpenDataDir()}
                    >
                      <FolderOpen size={14} />
                      Открыть папку
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void onCopyPath()}
                    >
                      <Copy size={14} />
                      Копировать путь
                    </Button>
                  </div>
                  <div className="settings-split" />
                  <h3 className="settings-subhead">Резервная копия</h3>
                  <p className="field-hint settings-section-hint">
                    Экспорт сохраняет все доски в один файл «sreda-backup.json». Импорт добавляет доски из
                    файла как копии, существующие доски не заменяются. Можно
                    также выбрать обычный файл одной доски.
                  </p>
                  <div className="settings-actions">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void onExportBackup()}
                    >
                      <Download size={14} />
                      Экспортировать все доски
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void onImportBackup()}
                    >
                      <Upload size={14} />
                      Импортировать копию
                    </Button>
                  </div>
                </>
              )}
              {section === "about" && (
                <div className="settings-about">
                  <span className="settings-about-logo" aria-hidden>
                    <BrandMark size={48} />
                  </span>
                  <h3>Среда</h3>
                  <p>Версия {packageInfo.version}</p>
                  <p className="field-hint">
                    Локальные канбан-доски. Данные остаются на вашем устройстве.
                    Совместная работа идёт по ссылке через защищённый туннель
                    ngrok.
                  </p>
                  <div className="settings-actions">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setNoticesOpen((value) => !value)}
                    >
                      {noticesOpen ? "Скрыть лицензии" : "Лицензии"}
                    </Button>
                  </div>
                  {noticesOpen && (
                    <pre className="settings-notices" tabIndex={0}>
                      {notices}
                    </pre>
                  )}
                </div>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
