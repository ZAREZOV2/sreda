import type { Color } from "./model.ts";

export const PROFILE_COLORS: Color[] = [
  "sage",
  "blue",
  "amber",
  "rose",
  "violet",
  "gray",
];

export const PROFILE_COLOR_NAMES: Record<Color, string> = {
  sage: "Шалфей",
  blue: "Синий",
  amber: "Янтарный",
  rose: "Розовый",
  violet: "Фиолетовый",
  gray: "Серый",
};

export const DEFAULT_DISPLAY_NAME = "Вы";
export const PROFILE_NAME_MAX = 40;

export type Profile = {
  displayName: string;
  color: Color;
};

export type UiPrefs = {
  themeId: string;
  profile: Profile;
};

export function isProfileColor(value: unknown): value is Color {
  return (
    typeof value === "string" &&
    (PROFILE_COLORS as string[]).includes(value)
  );
}

export function validateDisplayName(value: string): string | undefined {
  const name = value.trim();
  if (!name) return "Укажите, как вас представлять.";
  if (name.length > PROFILE_NAME_MAX)
    return "Имя слишком длинное (максимум 40 символов).";
  if (/[\u0000-\u001f\u007f]/.test(name))
    return "В имени есть недопустимые символы.";
  return undefined;
}

export function normalizeDisplayName(
  value: unknown,
  fallback = DEFAULT_DISPLAY_NAME,
): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim().slice(0, PROFILE_NAME_MAX);
  return trimmed || fallback;
}

export function defaultProfile(osName?: string | null): Profile {
  return {
    displayName: normalizeDisplayName(osName ?? "", DEFAULT_DISPLAY_NAME),
    color: "sage",
  };
}

export function normalizeProfile(
  value: unknown,
  fallbackName?: string | null,
): Profile {
  const fallback = defaultProfile(fallbackName);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }
  const raw = value as Record<string, unknown>;
  return {
    displayName: normalizeDisplayName(
      raw.displayName ?? raw.display_name,
      fallback.displayName,
    ),
    color: isProfileColor(raw.color) ? raw.color : fallback.color,
  };
}

export function parseUiPrefs(
  value: unknown,
  options?: { fallbackThemeId?: string; fallbackName?: string | null },
): UiPrefs {
  const fallbackThemeId = options?.fallbackThemeId || "graphite";
  const profileFallback = defaultProfile(options?.fallbackName);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { themeId: fallbackThemeId, profile: profileFallback };
  }
  const raw = value as Record<string, unknown>;
  const themeId =
    typeof raw.themeId === "string" && raw.themeId.trim()
      ? raw.themeId
      : fallbackThemeId;
  return {
    themeId,
    profile: normalizeProfile(raw.profile, options?.fallbackName),
  };
}

export function mergeUiPrefs(
  current: UiPrefs,
  patch: Partial<UiPrefs>,
): UiPrefs {
  return {
    themeId:
      typeof patch.themeId === "string" && patch.themeId.trim()
        ? patch.themeId
        : current.themeId,
    profile: patch.profile
      ? normalizeProfile(patch.profile, current.profile.displayName)
      : current.profile,
  };
}

export function initials(name: string): string {
  const parts = name
    .trim()
    .split(/[\s\-]+/)
    .filter(Boolean);
  if (parts.length === 0) return "В";
  const first = parts[0].match(/\p{L}|\p{N}/u)?.[0];
  const second =
    parts.length > 1 ? parts[1].match(/\p{L}|\p{N}/u)?.[0] : undefined;
  const letters = (first ?? "") + (second ?? "");
  return (letters || "В").toLocaleUpperCase("ru");
}
