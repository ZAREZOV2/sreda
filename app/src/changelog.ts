export type ReleaseNotes = {
  version: string;
  date: string | null;
  title: string;
  body: string;
};

const HEADING =
  /^##\s+(\d+\.\d+\.\d+)\s*(?:[—–-]\s*(?:(\d{4}-\d{2}-\d{2})\s*[—–-]\s*)?(.+))?$/;

/** Разбирает CHANGELOG.md: версии сверху вниз, как в файле. */
export function parseChangelog(markdown: string): ReleaseNotes[] {
  const lines = markdown.replace(/^\uFEFF/, "").split(/\r?\n/);
  const releases: ReleaseNotes[] = [];
  let current: ReleaseNotes | null = null;
  const body: string[] = [];
  const flush = () => {
    if (!current) return;
    current.body = body.join("\n").trim();
    releases.push(current);
    body.length = 0;
  };
  for (const line of lines) {
    const match = HEADING.exec(line.trim());
    if (match) {
      flush();
      current = {
        version: match[1],
        date: match[2] ?? null,
        title: (match[3] ?? "").trim(),
        body: "",
      };
      continue;
    }
    if (current) body.push(line);
  }
  flush();
  return releases;
}
