import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUILTIN_THEMES,
  KNOWN_TOKENS,
  isKnownToken,
  isSafeThemeFilename,
  parseTheme,
  parseThemeText,
  safeThemeFilename,
  sanitizeThemeCss,
  sanitizeTokenValue,
} from "../src/theme.ts";

const here = dirname(fileURLToPath(import.meta.url));

function builtinFile(name: string) {
  return JSON.parse(
    readFileSync(
      join(here, "../src/themes", name + ".sreda-theme.json"),
      "utf8",
    ),
  );
}

test("schema token list is loaded", () => {
  assert.ok(KNOWN_TOKENS.size >= 70);
  assert.equal(isKnownToken("accent"), true);
  assert.equal(isKnownToken("background"), false);
  assert.equal(isKnownToken("--accent"), false);
});

test("four starter themes parse and keep their names", () => {
  const names = BUILTIN_THEMES.map((t) => t.theme.name);
  assert.deepEqual(names, ["Графит", "Бумага", "Полярная ночь", "Терминал"]);
  assert.equal(BUILTIN_THEMES[0].theme.base, "dark");
  assert.equal(BUILTIN_THEMES[1].theme.base, "light");
  for (const record of BUILTIN_THEMES) {
    const parsed = parseTheme(builtinFile(record.id));
    assert.equal(parsed.ok, true, record.id);
  }
});

test("missing tokens are allowed (fallback to base theme)", () => {
  const parsed = parseTheme({
    name: "Мини",
    version: "1.0.0",
    base: "dark",
    tokens: { accent: "#7ee0c0" },
  });
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.deepEqual(parsed.theme.tokens, { accent: "#7ee0c0" });
  }
});

test("rejects unknown tokens", () => {
  const parsed = parseTheme({
    name: "Плохая",
    version: "1.0.0",
    base: "dark",
    tokens: { accent: "#abc", "evil-token": "red" },
  });
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.ok(parsed.errors.some((e) => e.path === "tokens.evil-token"));
  }
});

test("rejects unknown top-level fields", () => {
  const parsed = parseTheme({
    name: "Лишняя",
    version: "1.0.0",
    base: "dark",
    tokens: {},
    script: "alert(1)",
  });
  assert.equal(parsed.ok, false);
});

test("version must be semver X.Y.Z", () => {
  const parsed = parseTheme({
    name: "Версия",
    version: "1.0",
    base: "light",
    tokens: {},
  });
  assert.equal(parsed.ok, false);
});

test("token sanitizer blocks urls, js and punctuation", () => {
  assert.equal(sanitizeTokenValue("#a9c580"), "#a9c580");
  assert.equal(sanitizeTokenValue("  12px  "), "12px");
  assert.equal(sanitizeTokenValue("url(https://evil.test/x.png)"), null);
  assert.equal(sanitizeTokenValue("URL(//evil.test)"), null);
  assert.equal(sanitizeTokenValue("javascript:alert(1)"), null);
  assert.equal(sanitizeTokenValue("expression(alert(1))"), null);
  assert.equal(sanitizeTokenValue("@import 'x.css'"), null);
  assert.equal(sanitizeTokenValue("red; color: blue"), null);
  assert.equal(sanitizeTokenValue("foo{background:red}"), null);
  assert.equal(sanitizeTokenValue("a</style><script>"), null);
  assert.equal(sanitizeTokenValue(""), null);
});

test("theme parser rejects unsafe token values", () => {
  const parsed = parseTheme({
    name: "Инъекция",
    version: "1.0.0",
    base: "dark",
    tokens: { bg: "url(https://evil.test/bg.png)" },
  });
  assert.equal(parsed.ok, false);
});

test("css sanitizer allows aurora and terminal extras", () => {
  const aurora = builtinFile("aurora");
  const terminal = builtinFile("terminal");
  const a = sanitizeThemeCss(aurora.css);
  const b = sanitizeThemeCss(terminal.css);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
});

test("css sanitizer rejects imports, urls and script", () => {
  const cases = [
    "@import url('https://evil.test/x.css');",
    "body { background: url(https://evil.test/bg.png); }",
    "body { background: url('//evil.test/bg.png'); }",
    "body { color: expression(alert(1)); }",
    "body { behavior: url(x.htc); }",
    "div { -moz-binding: url(http://x); }",
    "a { color: javascript:alert(1); }",
    "</style><script>alert(1)</script>",
  ];
  for (const css of cases) {
    const result = sanitizeThemeCss(css);
    assert.equal(result.ok, false, css);
  }
  const ok = sanitizeThemeCss(
    ".brand-period { text-shadow: 0 0 12px rgba(126,224,192,0.6); }",
  );
  assert.equal(ok.ok, true);
});

test("parseThemeText reports invalid json", () => {
  const parsed = parseThemeText("{not json");
  assert.equal(parsed.ok, false);
});

test("safe theme filenames stay ascii and reject traversal", () => {
  assert.equal(safeThemeFilename("Paper"), "paper.sreda-theme.json");
  assert.equal(
    isSafeThemeFilename(safeThemeFilename("Полярная ночь")),
    true,
  );
  assert.equal(isSafeThemeFilename("../etc/passwd"), false);
  assert.equal(isSafeThemeFilename("foo.sreda-theme.json/../x"), false);
  assert.equal(isSafeThemeFilename("theme.json"), false);
  assert.equal(isSafeThemeFilename("ok.sreda-theme.json"), true);
});
