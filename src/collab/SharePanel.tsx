import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "../components/ui/button";
import { FieldLabel } from "../components/FieldLabel";
import { initials } from "../profile";
import type { Participant } from "./reducer";
import {
  hasFieldErrors,
  validateJoinForm,
  validateShareSettings,
  type JoinFieldErrors,
  type ShareFieldErrors,
} from "./validate";

export type HostStatus = {
  running: boolean;
  publicUrl?: string | null;
  inviteLink?: string | null;
  staticDomain: boolean;
  workspaceId?: string | null;
  hostId?: string | null;
  participants: Participant[];
};

export type ShareSettings = {
  ngrokAuthtoken: string;
  staticDomain: string;
};

function HowItWorks({ steps }: { steps: string[] }) {
  return (
    <details className="how-it-works">
      <summary>
        <ChevronRight className="how-it-works-chevron" size={14} aria-hidden />
        Подробнее <span>· как это работает</span>
      </summary>
      <ol>
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </details>
  );
}


function onOpenAutoFocus(event: Event) {
  event.preventDefault();
  const root = event.currentTarget as HTMLElement | null;
  root
    ?.querySelector<HTMLElement>("input:not([type='hidden']), textarea, select")
    ?.focus();
}

const shareSteps = [
  "Чтобы пригласить людей через интернет, укажите токен ngrok. Без токена узел доступен только на этом компьютере.",
  "Статический домен необязателен: с ним ссылка не меняется после перезапуска, на ngrok он есть в бесплатном тарифе.",
  "Нажмите «Открыть доступ» и отправьте ссылку-приглашение. Она действует 7 дней или пока вы её не отзовёте.",
  "Пока узел запущен, гости работают с вашими досками в реальном времени. «Отозвать ссылку» отключает текущих гостей и выдаёт новую; «Остановить доступ» закрывает узел.",
];

const joinSteps = [
  "Скопируйте ссылку-приглашение целиком, включая часть после #.",
  "Укажите имя, под которым вас увидят хозяин и другие гости.",
  "Нажмите «Подключиться». Если вы уже заходили в это пространство, доска присоединится заново, без дубликата.",
  "Если связь оборвётся и у хозяина нет статического домена, попросите новую ссылку. Когда узел закроют, можно сохранить локальную копию или дождаться следующего приглашения.",
];

const closedSteps = [
  "Пока узел закрыт, изменения хозяина до вас не доходят.",
  "«Закрыть до следующего расшара» оставляет доску в списке как отключённую. Новая ссылка на то же пространство присоединит её заново, без дубликата.",
  "«Сохранить копию локально» переносит доски в ваше пространство как обычные локальные. Связь с хозяином при этом не сохраняется.",
  "Без статического домена ссылка после перезапуска узла меняется — попросите у хозяина новую.",
];

export function SharePanel({
  open,
  onOpenChange,
  status,
  settings,
  onSettings,
  onStart,
  onStop,
  onRevoke,
  busy,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: HostStatus;
  settings: ShareSettings;
  onSettings: (settings: ShareSettings) => void;
  onStart: () => void;
  onStop: () => void;
  onRevoke: () => void;
  busy: boolean;
  error: string;
}) {
  const [fieldErrors, setFieldErrors] = useState<ShareFieldErrors>({});
  useEffect(() => {
    if (!open) setFieldErrors({});
  }, [open]);

  const start = () => {
    const next = validateShareSettings(settings);
    setFieldErrors(next);
    if (hasFieldErrors(next)) return;
    onStart();
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="info-dialog edit-dialog share-dialog"
          onOpenAutoFocus={onOpenAutoFocus}
        >
          <div className="share-dialog-body">
          <div className="modal-heading share-heading">
            <div>
              <Dialog.Title>Поделиться</Dialog.Title>
              <Dialog.Description>
                Поделитесь доской: другие смогут работать в ней вместе с вами в
                реальном времени. Данные остаются на вашем компьютере, гости
                подключаются через защищённый туннель ngrok.
              </Dialog.Description>
            </div>
          </div>
          <HowItWorks steps={shareSteps} />

          <section className="share-section">
            <h3>Настройки узла</h3>
            <label className="field">
              <FieldLabel optional>Токен ngrok</FieldLabel>
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={settings.ngrokAuthtoken}
                aria-invalid={!!fieldErrors.token}
                onChange={(e) => {
                  onSettings({ ...settings, ngrokAuthtoken: e.target.value });
                  setFieldErrors((current) => ({ ...current, token: undefined }));
                }}
                onBlur={(e) =>
                  setFieldErrors(
                    validateShareSettings({
                      ...settings,
                      ngrokAuthtoken: e.target.value,
                    }),
                  )
                }
                placeholder="ngrok_xxxxxxxxxxxxxxxx"
              />
              <span className="field-hint">
                Токен из кабинета ngrok: dashboard.ngrok.com → Your Authtoken.
                Нужен, чтобы открыть доступ через интернет.
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
                value={settings.staticDomain}
                aria-invalid={!!fieldErrors.staticDomain}
                onChange={(e) => {
                  onSettings({ ...settings, staticDomain: e.target.value });
                  setFieldErrors((current) => ({
                    ...current,
                    staticDomain: undefined,
                  }));
                }}
                onBlur={(e) =>
                  setFieldErrors(
                    validateShareSettings({
                      ...settings,
                      staticDomain: e.target.value,
                    }),
                  )
                }
                placeholder="sreda.ngrok.app"
              />
              <span className="field-hint">
                Постоянный адрес: ссылка не меняется между запусками. На ngrok
                статический домен есть в бесплатном тарифе. Без домена после
                перезапуска понадобится новая ссылка.
              </span>
              {fieldErrors.staticDomain && (
                <span className="field-error" role="alert">
                  {fieldErrors.staticDomain}
                </span>
              )}
            </label>
          </section>

          <section className="share-section share-section-access">
            <h3>Ссылка-приглашение и участники</h3>
            <p className="field-hint share-status-hint">
              {status.running
                ? status.staticDomain
                  ? "Доступ открыт по постоянному адресу. Гости могут переподключиться по той же ссылке."
                  : status.publicUrl?.includes("127.0.0.1")
                    ? "Доступ открыт локально. Чтобы пригласить людей через интернет, укажите токен ngrok и откройте доступ снова."
                    : "Доступ открыт по временной ссылке. Она действует 7 дней или до отзыва; после перезапуска попросите гостей вставить новую."
                : "Пока доступ закрыт. Откройте его, чтобы получить ссылку-приглашение."}
            </p>
            {status.inviteLink && (
              <label className="field">
                <FieldLabel>Ссылка-приглашение</FieldLabel>
                <textarea rows={2} readOnly value={status.inviteLink} />
                <span className="field-hint">
                  Ссылка действует 7 дней или пока вы её не отзовёте. Отзыв
                  отключает текущих гостей и выдаёт новую ссылку.
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void navigator.clipboard.writeText(status.inviteLink!)
                  }
                >
                  Копировать ссылку
                </Button>
              </label>
            )}
            {status.running && (
              <div className="participant-list">
                <span>
                  Участники
                  <span className="field-tag">{status.participants.length}</span>
                </span>
                {status.participants.length === 0 ? (
                  <p className="field-hint">Пока никто не подключился.</p>
                ) : (
                  <ul>
                    {status.participants.map((person) => (
                      <li key={person.id}>
                        <span
                          className={
                            "participant-avatar color-" + (person.color || "sage")
                          }
                          aria-hidden
                        >
                          {initials(person.name)}
                        </span>
                        <span>
                          {person.name}
                          {person.role === "host" ? " · хозяин" : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>

          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          </div>
          <div className="modal-buttons">
            {status.running && (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={onRevoke}
              >
                Отозвать ссылку
              </Button>
            )}
            {status.running ? (
              <Button
                type="button"
                className="button-danger"
                disabled={busy}
                onClick={onStop}
              >
                Остановить доступ
              </Button>
            ) : (
              <Button type="button" disabled={busy} onClick={start}>
                {busy ? "Запускаем…" : "Открыть доступ"}
              </Button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function JoinDialog({
  open,
  onOpenChange,
  value,
  onChange,
  name,
  onNameChange,
  onJoin,
  busy,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onChange: (value: string) => void;
  name: string;
  onNameChange: (name: string) => void;
  onJoin: () => void;
  busy: boolean;
  error: string;
}) {
  const [fieldErrors, setFieldErrors] = useState<JoinFieldErrors>({});
  useEffect(() => {
    if (!open) setFieldErrors({});
  }, [open]);

  const submit = () => {
    const next = validateJoinForm(value, name);
    setFieldErrors(next);
    if (hasFieldErrors(next)) return;
    onJoin();
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="info-dialog edit-dialog share-dialog"
          onOpenAutoFocus={onOpenAutoFocus}
        >
          <div className="share-dialog-body">
          <div className="modal-heading share-heading">
            <div>
              <Dialog.Title>Подключиться по ссылке</Dialog.Title>
              <Dialog.Description>
                Вставьте ссылку, которую прислал хозяин. Вы будете работать на
                его доске в реальном времени. Если вы уже подключались к этому
                пространству, доска присоединится заново, без дубликата.
              </Dialog.Description>
            </div>
          </div>
          <HowItWorks steps={joinSteps} />
          <label className="field">
            <FieldLabel required>Ссылка-приглашение</FieldLabel>
            <textarea
              rows={4}
              value={value}
              aria-invalid={!!fieldErrors.link}
              onChange={(e) => {
                onChange(e.target.value);
                setFieldErrors((current) => ({ ...current, link: undefined }));
              }}
              onBlur={() =>
                setFieldErrors((current) => ({
                  ...current,
                  link: validateJoinForm(value, name).link,
                }))
              }
              placeholder="https://sreda.ngrok.app#sreda-invite=…"
            />
            <span className="field-hint">
              Ссылка выглядит как адрес с #sreda-invite=. Её выдаёт хозяин в
              панели «Поделиться».
            </span>
            {fieldErrors.link && (
              <span className="field-error" role="alert">
                {fieldErrors.link}
              </span>
            )}
          </label>
          <label className="field">
            <FieldLabel required>Ваше имя</FieldLabel>
            <input
              value={name}
              maxLength={40}
              aria-invalid={!!fieldErrors.name}
              onChange={(e) => {
                onNameChange(e.target.value);
                setFieldErrors((current) => ({ ...current, name: undefined }));
              }}
              onBlur={() =>
                setFieldErrors((current) => ({
                  ...current,
                  name: validateJoinForm(value, name).name,
                }))
              }
              placeholder="Анна"
            />
            <span className="field-hint">
              Так вас увидят хозяин и другие гости.
            </span>
            {fieldErrors.name && (
              <span className="field-error" role="alert">
                {fieldErrors.name}
              </span>
            )}
          </label>
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          </div>
          <div className="modal-buttons">
            <Dialog.Close asChild>
              <Button type="button" variant="ghost">
                Отмена
              </Button>
            </Dialog.Close>
            <Button type="button" disabled={busy} onClick={submit}>
              {busy ? "Подключаемся…" : "Подключиться"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function HostClosedDialog({
  open,
  boardName,
  onSaveLocal,
  onKeep,
}: {
  open: boolean;
  boardName?: string;
  onSaveLocal: () => void;
  onKeep: () => void;
}) {
  return (
    <Dialog.Root open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="info-dialog edit-dialog share-dialog"
          onOpenAutoFocus={onOpenAutoFocus}
        >
          <div className="share-dialog-body">
          <div className="modal-heading share-heading">
            <div>
              <Dialog.Title>Узел закрыт</Dialog.Title>
              <Dialog.Description>
                Хозяин остановил доступ
                {boardName ? ` к «${boardName}»` : ""}. Доска больше не
                синхронизируется. Выберите, что сделать с данными этого сеанса.
              </Dialog.Description>
            </div>
          </div>
          <HowItWorks steps={closedSteps} />
          <ul className="closed-options">
            <li>
              <strong>Закрыть до следующего расшара.</strong> Доска останется в
              списке как отключённая. Когда хозяин пришлёт новую ссылку на то
              же пространство, она присоединится заново, без дубликата.
            </li>
            <li>
              <strong>Сохранить копию локально.</strong> Доски копируются в ваше
              пространство как обычные локальные. Связь с хозяином при этом не
              сохраняется.
            </li>
          </ul>
          </div>
          <div className="modal-buttons share-actions">
            <Button type="button" variant="outline" onClick={onKeep}>
              Закрыть до следующего расшара
            </Button>
            <Button type="button" onClick={onSaveLocal}>
              Сохранить копию локально
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
