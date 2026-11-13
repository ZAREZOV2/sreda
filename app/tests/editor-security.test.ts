import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { common, createLowlight } from "lowlight";
import { Window } from "happy-dom";
import {
  markdownOf,
  openDocumentEditor,
} from "../src/markdown/editorExtensions.ts";

const require = createRequire(import.meta.url);

function packageVersion(specifier: string, from?: string) {
  const resolved = (from ? createRequire(from) : require).resolve(specifier);
  let dir = path.dirname(resolved);
  const root = path.parse(dir).root;
  while (dir !== root) {
    const manifest = path.join(dir, "package.json");
    if (fs.existsSync(manifest)) {
      const data = JSON.parse(fs.readFileSync(manifest, "utf8")) as {
        name?: string;
        version?: string;
      };
      if (data.name === specifier || data.name === specifier.split("/")[0])
        return data.version ?? "";
    }
    dir = path.dirname(dir);
  }
  throw new Error(`нет package.json для ${specifier}`);
}

function atLeast(version: string, floor: string) {
  const left = version.split(".").map((part) => Number(part));
  const right = floor.split(".").map((part) => Number(part));
  for (let index = 0; index < 3; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}

const SAMPLE = `# Заголовок

Текст **жирный** и [ссылка](https://example.com/docs).

- [ ] задача
- [x] готово

| Колонка | Значение |
| --- | --- |
| Альфа | Бета |

\`\`\`js
const x = 1
\`\`\`

![схема](sreda-attachment:abc)

Пояснение к рисунку.

> [!NOTE]
> Важно не потерять выноску
`;

test("locked TipTap and KaTeX are past the advisories", () => {
  const tiptap = packageVersion("@tiptap/core");
  const direct = packageVersion("katex");
  const fromRehype = packageVersion("katex", require.resolve("rehype-katex"));
  const fromMath = packageVersion(
    "katex",
    require.resolve("micromark-extension-math"),
  );
  const fromMermaid = packageVersion("katex", require.resolve("mermaid"));
  assert.equal(atLeast(tiptap, "3.30.4"), true, tiptap);
  for (const version of [direct, fromRehype, fromMath, fromMermaid]) {
    assert.equal(atLeast(version, "0.18.2"), true, version);
  }
});

test("preview keeps GFM, KaTeX and highlighted code", () => {
  const html = renderToStaticMarkup(
    createElement(Markdown, {
      remarkPlugins: [remarkGfm, remarkMath],
      rehypePlugins: [rehypeKatex],
      children:
        "| Колонка | Значение |\n| --- | --- |\n| Альфа | Бета |\n\n- [ ] задача\n\n[ссылка](https://example.com/docs)\n\n$$\nE=mc^2\n$$\n\n`inline`",
    }),
  );
  assert.match(html, /<table/);
  assert.match(html, /Альфа/);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /href="https:\/\/example.com\/docs"/);
  assert.match(html, /class="katex"/);
  const lowlight = createLowlight(common);
  const tree = lowlight.highlight("js", "const x = 1");
  assert.ok(tree.children.length > 0);
});

function installDom() {
  const window = new Window();
  const names = [
    "window",
    "document",
    "Node",
    "Element",
    "HTMLElement",
    "DocumentFragment",
    "DOMParser",
    "MutationObserver",
    "Range",
    "Text",
    "Comment",
    "NodeFilter",
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ];
  for (const name of names) {
    const value = name === "window" ? window : window[name as keyof Window];
    Object.defineProperty(globalThis, name, {
      value,
      configurable: true,
      writable: true,
    });
  }
  return window;
}

test("visual editor round-trips markdown for tables, tasks, code, images and links", () => {
  const window = installDom();
  const editor = openDocumentEditor(SAMPLE);
  const markdown = markdownOf(editor);
  editor.destroy();
  window.close();
  assert.match(markdown, /Заголовок/);
  assert.match(markdown, /\*\*жирный\*\*/);
  assert.match(markdown, /https:\/\/example.com\/docs/);
  assert.match(markdown, /- \[ \] задача/);
  assert.match(markdown, /- \[x\] готово/);
  assert.match(markdown, /Альфа/);
  assert.match(markdown, /Бета/);
  assert.match(markdown, /```js/);
  assert.match(markdown, /const x = 1/);
  assert.match(markdown, /sreda-attachment:abc/);
  assert.match(markdown, /Важно не потерять выноску/);
  assert.match(markdown, /^> /m);
  const preview = renderToStaticMarkup(
    createElement(Markdown, {
      remarkPlugins: [remarkGfm],
      children: markdown,
    }),
  );
  assert.match(preview, /<blockquote/);
  assert.match(preview, /\[!NOTE\]/);
});
