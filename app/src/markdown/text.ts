export type CheckItem = {
  line: number;
  checked: boolean;
  text: string;
  cardId?: string;
  indent: string;
};

const TASK_LINE =
  /^(\s*)[-*]\s+\[([ xX])\]\s+(.*)$/;
const CARD_MARK = /\s*<!--\s*sreda-card:([A-Za-z0-9_-]+)\s*-->\s*$/;
const WIKI = /\[\[([^\]\n]{1,200})\]\]/g;

function splitFences(markdown: string): { code: boolean; text: string }[] {
  const parts: { code: boolean; text: string }[] = [];
  const re = /```[\s\S]*?```/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown))) {
    if (match.index > last)
      parts.push({ code: false, text: markdown.slice(last, match.index) });
    parts.push({ code: true, text: match[0] });
    last = match.index + match[0].length;
  }
  if (last < markdown.length) parts.push({ code: false, text: markdown.slice(last) });
  if (!parts.length) parts.push({ code: false, text: markdown });
  return parts;
}

export function parseChecklist(markdown: string): CheckItem[] {
  const items: CheckItem[] = [];
  const lines = markdown.split(/\r?\n/);
  let offset = 0;
  let inFence = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^```/.test(line.trim())) inFence = !inFence;
    if (!inFence) {
      const match = TASK_LINE.exec(line);
      if (match) {
        const body = match[3];
        const card = CARD_MARK.exec(body);
        items.push({
          line: index,
          indent: match[1],
          checked: match[2].toLowerCase() === "x",
          text: (card ? body.slice(0, card.index) : body).trim(),
          cardId: card?.[1],
        });
      }
    }
    offset += line.length + 1;
    void offset;
  }
  return items;
}

export function checklistLine(item: CheckItem): string {
  const mark = item.checked ? "x" : " ";
  const card = item.cardId ? ` <!-- sreda-card:${item.cardId} -->` : "";
  return `${item.indent}- [${mark}] ${item.text}${card}`;
}

export function replaceChecklistLine(markdown: string, item: CheckItem): string {
  const lines = markdown.split(/\r?\n/);
  if (item.line < 0 || item.line >= lines.length) return markdown;
  lines[item.line] = checklistLine(item);
  return lines.join("\n");
}

export function setChecklistChecked(
  markdown: string,
  cardId: string,
  checked: boolean,
): string {
  const items = parseChecklist(markdown);
  let next = markdown;
  for (const item of items) {
    if (item.cardId !== cardId || item.checked === checked) continue;
    next = replaceChecklistLine(next, { ...item, checked });
  }
  return next;
}

export type WikiLink = { raw: string; title: string; card: boolean };

export function parseWikiLinks(markdown: string): WikiLink[] {
  const links: WikiLink[] = [];
  for (const part of splitFences(markdown)) {
    if (part.code) continue;
    for (const match of part.text.matchAll(WIKI)) {
      const raw = match[1].trim();
      if (!raw) continue;
      const card = /^card:/i.test(raw) || /^карточка:/i.test(raw);
      const title = raw.replace(/^(?:card|карточка):/i, "").trim();
      if (!title) continue;
      links.push({ raw, title, card });
    }
  }
  return links;
}

export function backlinkTitles(markdown: string): string[] {
  return [...new Set(parseWikiLinks(markdown).filter((link) => !link.card).map((link) => link.title))];
}

export type TocItem = { level: number; text: string; id: string };

export function slugHeading(text: string): string {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "section";
}

export function tableOfContents(markdown: string): TocItem[] {
  const items: TocItem[] = [];
  let inFence = false;
  const seen = new Map<string, number>();
  for (const line of markdown.split(/\r?\n/)) {
    if (/^```/.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    const text = match[2].replace(/\[(.*?)\]\(.*?\)/g, "$1").trim();
    let id = slugHeading(text);
    const count = seen.get(id) ?? 0;
    seen.set(id, count + 1);
    if (count) id = id + "-" + count;
    items.push({ level: match[1].length, text, id });
  }
  return items;
}

export function linkifyWiki(markdown: string): string {
  return splitFences(markdown)
    .map((part) => {
      if (part.code) return part.text;
      return part.text.replace(WIKI, (_all, inner: string) => {
        const raw = String(inner).trim();
        const card = /^(?:card|карточка):/i.test(raw);
        const title = raw.replace(/^(?:card|карточка):/i, "").trim();
        if (!title) return _all;
        const href = card
          ? `sreda-card:${encodeURIComponent(title)}`
          : `sreda-doc:${encodeURIComponent(title)}`;
        return `[${title}](${href})`;
      });
    })
    .join("");
}

export const templates = [
  {
    id: "meeting",
    name: "Заметка со встречи",
    markdown: `# Встреча

**Когда:**  
**Кто:**  

## Повестка

- 

## Решения

- 

## Дальше

- [ ] 
`,
  },
  {
    id: "spec",
    name: "ТЗ",
    markdown: `# Техническое задание

## Задача

## Контекст

## Требования

- [ ] 

## Вне рамок

## Готово, когда

- 
`,
  },
  {
    id: "retro",
    name: "Ретро",
    markdown: `# Ретро

## Что получилось

- 

## Что мешало

- 

## Что попробуем

- [ ] 
`,
  },
] as const;

export type BlockSnippet = { id: string; label: string; insert: string };

export const blockSnippets: BlockSnippet[] = [
  { id: "h2", label: "Заголовок", insert: "## " },
  { id: "todo", label: "Чек-лист", insert: "- [ ] " },
  { id: "quote", label: "Цитата", insert: "> " },
  { id: "note", label: "Заметка", insert: "> [!NOTE]\n> " },
  { id: "table", label: "Таблица", insert: "| Колонка | Колонка |\n| --- | --- |\n|  |  |\n" },
  { id: "code", label: "Код", insert: "```\n\n```\n" },
  { id: "math", label: "Формула", insert: "$$\n\n$$\n" },
  { id: "mermaid", label: "Диаграмма", insert: "```mermaid\nflowchart LR\n  A[Старт] --> B[Готово]\n```\n" },
];
