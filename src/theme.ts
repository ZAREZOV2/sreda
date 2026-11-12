import schema from "./themes/sreda-theme.schema.json" with { type: "json" };
import graphite from "./themes/graphite.sreda-theme.json" with { type: "json" };
import paper from "./themes/paper.sreda-theme.json" with { type: "json" };
import aurora from "./themes/aurora.sreda-theme.json" with { type: "json" };
import terminal from "./themes/terminal.sreda-theme.json" with { type: "json" };
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  mergeUiPrefs,
  parseUiPrefs,
  type UiPrefs,
} from "./profile.ts";

export type { UiPrefs };

export type ThemeBase = "dark" | "light";

export type SredaTheme = {
  name: string;
  author?: string;
  version: string;
  base: ThemeBase;
  description?: string;
  tokens: Record<string, string>;
  css?: string;
  $schema?: string;
};

export type ThemeIssue = { path: string; message: string };

export type ThemeParseResult =
  | { ok: true; theme: SredaTheme; warnings: ThemeIssue[] }
  | { ok: false; errors: ThemeIssue[]; warnings: ThemeIssue[] };

export type ThemeSource = "builtin" | "user";

export type ThemeRecord = {
  source: ThemeSource;
  id: string;
  theme: SredaTheme;
};


const TOKENS_ENUM = (
  schema as { properties: { tokens: { propertyNames: { enum: string[] } } } }
).properties.tokens.propertyNames.enum;

export const KNOWN_TOKENS: ReadonlySet<string> = new Set(TOKENS_ENUM);

export const THEME_FILE_SUFFIX = ".sreda-theme.json";
const PREF_KEY = "sreda.theme-id";
const BASE_KEY = "sreda.theme-base";
const USER_KEY = "sreda.user-themes";

const TOKEN_BAD_CHARS = /[;{}<>\\]/;
const TOKEN_FORBIDDEN = /url\s*\(|expression\s*\(|javascript:|@import/i;
const CSS_FORBIDDEN =
  /@import|javascript:|expression\s*\(|behavior\s*:|-moz-binding|<\s*\/?\s*style|<\s*script|url\s*\(/i;

export function isKnownToken(name: string): boolean {
  return KNOWN_TOKENS.has(name);
}

export function sanitizeTokenValue(value: string): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (v.length < 1 || v.length > 300) return null;
  if (TOKEN_BAD_CHARS.test(v) || TOKEN_FORBIDDEN.test(v)) return null;
  return v;
}

export function sanitizeThemeCss(
  css: string,
): { ok: true; css: string } | { ok: false; errors: ThemeIssue[] } {
  if (typeof css !== "string") {
    return { ok: false, errors: [{ path: "css", message: "CSS должен быть строкой" }] };
  }
  if (css.length > 20_000) {
    return {
      ok: false,
      errors: [{ path: "css", message: "CSS длиннее 20 000 символов" }],
    };
  }
  if (CSS_FORBIDDEN.test(css)) {
    return {
      ok: false,
      errors: [
        {
          path: "css",
          message:
            "В CSS запрещены @import, url(), javascript:, expression() и вставка тегов",
        },
      ],
    };
  }
  return { ok: true, css };
}

function issue(path: string, message: string): ThemeIssue {
  return { path, message };
}

export function parseTheme(input: unknown): ThemeParseResult {
  const errors: ThemeIssue[] = [];
  const warnings: ThemeIssue[] = [];
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return {
      ok: false,
      errors: [issue("", "Тема должна быть JSON-объектом")],
      warnings,
    };
  }
  const raw = input as Record<string, unknown>;
  const allowed = new Set([
    "$schema",
    "name",
    "author",
    "version",
    "description",
    "base",
    "tokens",
    "css",
  ]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) {
      errors.push(issue(key, "Неизвестное поле"));
    }
  }
  if (typeof raw.name !== "string" || raw.name.trim().length < 1) {
    errors.push(issue("name", "Укажите название темы"));
  } else if (raw.name.length > 60) {
    errors.push(issue("name", "Название длиннее 60 символов"));
  }
  if (raw.author !== undefined) {
    if (typeof raw.author !== "string") {
      errors.push(issue("author", "Автор должен быть строкой"));
    } else if (raw.author.length > 80) {
      errors.push(issue("author", "Автор длиннее 80 символов"));
    }
  }
  if (typeof raw.version !== "string" || !/^\d+\.\d+\.\d+$/.test(raw.version)) {
    errors.push(issue("version", "Версия должна быть в формате X.Y.Z"));
  }
  if (raw.description !== undefined) {
    if (typeof raw.description !== "string") {
      errors.push(issue("description", "Описание должно быть строкой"));
    } else if (raw.description.length > 300) {
      errors.push(issue("description", "Описание длиннее 300 символов"));
    }
  }
  if (raw.base !== "dark" && raw.base !== "light") {
    errors.push(issue("base", "База темы — dark или light"));
  }
  if (raw.tokens === undefined) {
    errors.push(issue("tokens", "Нужен объект tokens"));
  } else if (
    raw.tokens === null ||
    typeof raw.tokens !== "object" ||
    Array.isArray(raw.tokens)
  ) {
    errors.push(issue("tokens", "tokens должен быть объектом"));
  } else {
    const tokens = raw.tokens as Record<string, unknown>;
    for (const [key, value] of Object.entries(tokens)) {
      if (!isKnownToken(key)) {
        errors.push(issue(`tokens.${key}`, "Неизвестный токен"));
        continue;
      }
      if (typeof value !== "string") {
        errors.push(issue(`tokens.${key}`, "Значение токена должно быть строкой"));
        continue;
      }
      if (!sanitizeTokenValue(value)) {
        errors.push(
          issue(
            `tokens.${key}`,
            "Недопустимое значение: без url(), javascript:, @import и служебных символов",
          ),
        );
      }
    }
  }
  let css: string | undefined;
  if (raw.css !== undefined) {
    if (typeof raw.css !== "string") {
      errors.push(issue("css", "CSS должен быть строкой"));
    } else {
      const cleaned = sanitizeThemeCss(raw.css);
      if (!cleaned.ok) errors.push(...cleaned.errors);
      else css = cleaned.css;
    }
  }
  if (errors.length) return { ok: false, errors, warnings };
  const tokens: Record<string, string> = {};
  for (const [key, value] of Object.entries(
    raw.tokens as Record<string, string>,
  )) {
    const clean = sanitizeTokenValue(value);
    if (clean) tokens[key] = clean;
  }
  const theme: SredaTheme = {
    name: (raw.name as string).trim(),
    version: raw.version as string,
    base: raw.base as ThemeBase,
    tokens,
  };
  if (typeof raw.$schema === "string") theme.$schema = raw.$schema;
  if (typeof raw.author === "string") theme.author = raw.author;
  if (typeof raw.description === "string") theme.description = raw.description;
  if (css) theme.css = css;
  return { ok: true, theme, warnings };
}

export function parseThemeText(text: string): ThemeParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return {
      ok: false,
      errors: [issue("", "Файл не является корректным JSON")],
      warnings: [],
    };
  }
  return parseTheme(data);
}

function asBuiltin(id: string, raw: unknown): ThemeRecord {
  const parsed = parseTheme(raw);
  if (!parsed.ok) {
    throw new Error(`Встроенная тема «${id}» не проходит проверку`);
  }
  return { source: "builtin", id, theme: parsed.theme };
}

export const BUILTIN_THEMES: ThemeRecord[] = [
  asBuiltin("graphite", graphite),
  asBuiltin("paper", paper),
  asBuiltin("aurora", aurora),
  asBuiltin("terminal", terminal),
];

export const DEFAULT_THEME_ID = "graphite";

export function findBuiltin(id: string): ThemeRecord | undefined {
  return BUILTIN_THEMES.find((t) => t.id === id);
}

export function themeKey(record: Pick<ThemeRecord, "source" | "id">): string {
  return record.source === "builtin" ? record.id : `user:${record.id}`;
}

export function parseThemeKey(key: string): { source: ThemeSource; id: string } {
  if (key.startsWith("user:")) return { source: "user", id: key.slice(5) };
  return { source: "builtin", id: key };
}

const appliedTokenNames = new Set<string>();

export function applyTheme(
  theme: SredaTheme,
  root: HTMLElement = document.documentElement,
): ThemeIssue[] {
  const issues: ThemeIssue[] = [];
  root.setAttribute("data-theme", theme.base);
  for (const name of appliedTokenNames) {
    root.style.removeProperty("--" + name);
  }
  appliedTokenNames.clear();
  for (const [key, value] of Object.entries(theme.tokens)) {
    const clean = sanitizeTokenValue(value);
    if (!clean || !isKnownToken(key)) {
      issues.push(issue(`tokens.${key}`, "Токен пропущен"));
      continue;
    }
    root.style.setProperty("--" + key, clean);
    appliedTokenNames.add(key);
  }
  const doc = root.ownerDocument ?? document;
  let style = doc.getElementById("theme-css") as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement("style");
    style.id = "theme-css";
    doc.head.appendChild(style);
  }
  if (theme.css) {
    const cleaned = sanitizeThemeCss(theme.css);
    if (cleaned.ok) style.textContent = cleaned.css;
    else {
      style.textContent = "";
      issues.push(...cleaned.errors);
    }
  } else {
    style.textContent = "";
  }
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(BASE_KEY, theme.base);
    } catch {
      /* ignore quota / private mode */
    }
  }
  return issues;
}

export function safeThemeFilename(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  let base = slug;
  if (!base) {
    let hash = 0;
    for (const ch of name) hash = (Math.imul(hash, 33) + ch.charCodeAt(0)) >>> 0;
    base = "theme-" + hash.toString(16);
  }
  return base.endsWith(THEME_FILE_SUFFIX) ? base : base + THEME_FILE_SUFFIX;
}

export function isSafeThemeFilename(filename: string): boolean {
  if (!filename.endsWith(THEME_FILE_SUFFIX)) return false;
  const base = filename.slice(0, -THEME_FILE_SUFFIX.length);
  return /^[a-zA-Z0-9_.-]+$/.test(base) && !base.includes("..") && base.length > 0;
}

function desktopMode(): boolean {
  try {
    return isTauri();
  } catch {
    return false;
  }
}

const PREFS_KEY = "sreda.ui-prefs";
let cachedPrefs: UiPrefs | null = null;

export async function loadUiPrefs(
  fallbackName?: string | null,
): Promise<UiPrefs> {
  let raw: unknown = null;
  if (desktopMode()) {
    try {
      raw = await invoke<unknown>("ui_prefs_get");
    } catch {
      /* fall through to localStorage */
    }
  }
  if (raw == null) {
    try {
      const stored = localStorage.getItem(PREFS_KEY);
      if (stored) raw = JSON.parse(stored);
      else {
        const themeId = localStorage.getItem(PREF_KEY);
        if (themeId) raw = { themeId };
      }
    } catch {
      /* ignore */
    }
  }
  const prefs = parseUiPrefs(raw, {
    fallbackThemeId: DEFAULT_THEME_ID,
    fallbackName,
  });
  cachedPrefs = prefs;
  return prefs;
}

export async function saveUiPrefs(patch: Partial<UiPrefs>): Promise<UiPrefs> {
  const current = cachedPrefs ?? (await loadUiPrefs());
  const next = mergeUiPrefs(current, patch);
  cachedPrefs = next;
  try {
    localStorage.setItem(PREF_KEY, next.themeId);
    localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  if (desktopMode()) {
    await invoke("ui_prefs_set", { prefs: next });
  }
  return next;
}

export type UserThemeFile = { filename: string; contents: string };

export async function loadUserThemes(): Promise<ThemeRecord[]> {
  const records: ThemeRecord[] = [];
  const seen = new Set<string>();
  const push = (filename: string, contents: string) => {
    if (!isSafeThemeFilename(filename) || seen.has(filename)) return;
    const parsed = parseThemeText(contents);
    if (!parsed.ok) return;
    seen.add(filename);
    records.push({ source: "user", id: filename, theme: parsed.theme });
  };
  if (desktopMode()) {
    try {
      const files = await invoke<UserThemeFile[]>("themes_list_user");
      for (const file of files) push(file.filename, file.contents);
    } catch {
      /* HTML fallback below */
    }
  }
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as UserThemeFile[];
      if (Array.isArray(parsed)) {
        for (const file of parsed) {
          if (file && typeof file.filename === "string" && typeof file.contents === "string") {
            push(file.filename, file.contents);
          }
        }
      }
    }
  } catch {
    /* ignore */
  }
  return records;
}

async function persistUserThemesLocal(files: UserThemeFile[]): Promise<void> {
  localStorage.setItem(USER_KEY, JSON.stringify(files));
}

export async function saveUserTheme(theme: SredaTheme, filename?: string): Promise<string> {
  const parsed = parseTheme(theme);
  if (!parsed.ok) {
    throw new Error(parsed.errors.map((e) => e.message).join("; "));
  }
  const name = filename && isSafeThemeFilename(filename)
    ? filename
    : safeThemeFilename(parsed.theme.name);
  const contents = JSON.stringify(
    { $schema: "./sreda-theme.schema.json", ...parsed.theme },
    null,
    2,
  );
  if (desktopMode()) {
    await invoke("themes_write_user", { filename: name, contents });
  } else {
    const existing = await loadUserThemeFilesLocal();
    const next = existing.filter((f) => f.filename !== name);
    next.push({ filename: name, contents });
    await persistUserThemesLocal(next);
  }
  return name;
}

export async function removeUserTheme(filename: string): Promise<void> {
  if (!isSafeThemeFilename(filename)) throw new Error("Некорректное имя файла");
  if (desktopMode()) {
    await invoke("themes_remove_user", { filename });
    return;
  }
  const existing = await loadUserThemeFilesLocal();
  await persistUserThemesLocal(existing.filter((f) => f.filename !== filename));
}

async function loadUserThemeFilesLocal(): Promise<UserThemeFile[]> {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as UserThemeFile[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function themesDirPath(): Promise<string | null> {
  if (!desktopMode()) return null;
  try {
    return await invoke<string>("themes_dir_path");
  } catch {
    return null;
  }
}

export async function pickThemeImport(): Promise<string | null> {
  if (desktopMode()) {
    return invoke<string | null>("themes_pick_import");
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".sreda-theme.json,application/json";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      file.text().then(resolve, () => resolve(null));
    };
    input.click();
  });
}

export async function pickThemeExport(theme: SredaTheme): Promise<boolean> {
  const filename = safeThemeFilename(theme.name);
  const contents = JSON.stringify(
    { $schema: "./sreda-theme.schema.json", ...theme },
    null,
    2,
  );
  if (desktopMode()) {
    return invoke<boolean>("themes_pick_export", { filename, contents });
  }
  const blob = new Blob([contents], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

export function swatchesFor(theme: SredaTheme): string[] {
  const keys = ["bg", "surface", "text", "accent", "primary", "danger"] as const;
  return keys.map((key) => theme.tokens[key]).filter((v): v is string => !!v);
}
