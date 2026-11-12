import { parseInviteLink } from "../share.ts";

export type ShareFieldErrors = {
  token?: string;
  staticDomain?: string;
};

export type JoinFieldErrors = {
  link?: string;
  name?: string;
};

export function validateNgrokToken(value: string): string | undefined {
  const token = value.trim();
  if (!token) return undefined;
  if (token.length < 8 || /\s/.test(token))
    return "Похоже, это не токен ngrok. Вставьте значение из dashboard.ngrok.com → Your Authtoken.";
  return undefined;
}

export function validateStaticDomain(
  value: string,
  token: string,
): string | undefined {
  const domain = value.trim();
  if (!domain) return undefined;
  if (/^https?:\/\//i.test(domain))
    return "Укажите только имя домена, без https://.";
  if (
    !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(
      domain,
    )
  )
    return "Некорректное имя домена. Пример: sreda.ngrok.app.";
  if (!token.trim())
    return "Чтобы использовать статический домен, укажите токен ngrok.";
  return undefined;
}

export function validateShareSettings(settings: {
  ngrokAuthtoken: string;
  staticDomain: string;
}): ShareFieldErrors {
  const errors: ShareFieldErrors = {};
  const tokenError = validateNgrokToken(settings.ngrokAuthtoken);
  const domainError = validateStaticDomain(
    settings.staticDomain,
    settings.ngrokAuthtoken,
  );
  if (tokenError) errors.token = tokenError;
  if (domainError) errors.staticDomain = domainError;
  return errors;
}

export function validateInviteInput(value: string): string | undefined {
  if (!value.trim()) return "Вставьте ссылку-приглашение.";
  try {
    parseInviteLink(value);
    return undefined;
  } catch (error) {
    return String(error);
  }
}

export function validateGuestName(value: string): string | undefined {
  const name = value.trim();
  if (!name) return "Укажите, как вас представлять.";
  if (name.length > 40) return "Имя слишком длинное (максимум 40 символов).";
  return undefined;
}

export function validateJoinForm(link: string, name: string): JoinFieldErrors {
  const errors: JoinFieldErrors = {};
  const linkError = validateInviteInput(link);
  const nameError = validateGuestName(name);
  if (linkError) errors.link = linkError;
  if (nameError) errors.name = nameError;
  return errors;
}

export function hasFieldErrors(
  errors: ShareFieldErrors | JoinFieldErrors,
): boolean {
  return Object.values(errors).some(Boolean);
}
