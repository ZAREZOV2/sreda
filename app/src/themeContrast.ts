export type ContrastWarning = {
  foreground: string;
  background: string;
  label: string;
  ratio: number;
  minimum: number;
};

const PAIRS: { fg: string; bg: string; label: string; minimum: number }[] = [
  { fg: "text", bg: "bg", label: "Текст на фоне", minimum: 4.5 },
  { fg: "text", bg: "surface", label: "Текст на карточке", minimum: 4.5 },
  { fg: "text-secondary", bg: "bg", label: "Вторичный текст на фоне", minimum: 4.5 },
  { fg: "muted", bg: "surface", label: "Приглушённый текст", minimum: 4.5 },
  { fg: "on-primary", bg: "primary", label: "Текст на основной кнопке", minimum: 4.5 },
  { fg: "on-danger", bg: "danger", label: "Текст на опасном действии", minimum: 4.5 },
  { fg: "accent-text", bg: "bg", label: "Акцент на фоне", minimum: 3 },
];

export function parseHexColor(value: string): [number, number, number] | null {
  const raw = value.trim();
  const match = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(raw);
  if (!match) return null;
  let hex = match[1];
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  const n = Number.parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(foreground: string, background: string): number | null {
  const fg = parseHexColor(foreground);
  const bg = parseHexColor(background);
  if (!fg || !bg) return null;
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function contrastWarnings(
  tokens: Record<string, string>,
): ContrastWarning[] {
  const warnings: ContrastWarning[] = [];
  for (const pair of PAIRS) {
    const fg = tokens[pair.fg];
    const bg = tokens[pair.bg];
    if (!fg || !bg) continue;
    const ratio = contrastRatio(fg, bg);
    if (ratio === null || ratio + 1e-6 >= pair.minimum) continue;
    warnings.push({
      foreground: pair.fg,
      background: pair.bg,
      label: pair.label,
      ratio,
      minimum: pair.minimum,
    });
  }
  return warnings;
}

export function formatRatio(ratio: number): string {
  return ratio.toFixed(2) + ":1";
}
