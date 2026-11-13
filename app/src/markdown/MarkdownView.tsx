import { useEffect, useMemo, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { common, createLowlight } from "lowlight";
import { linkifyWiki } from "./text";
import "katex/dist/katex.min.css";

const lowlight = createLowlight(common);

function textOf(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node) {
    return textOf((node as { props?: { children?: React.ReactNode } }).props?.children);
  }
  return "";
}

function paint(node: { type: string; value?: string; tagName?: string; properties?: { className?: string[] }; children?: never[] }): React.ReactNode {
  if (node.type === "text") return node.value;
  if (node.type === "element") {
    const className = node.properties?.className?.join(" ");
    return (
      <span className={className}>
        {(node.children ?? []).map((child, index) => (
          <span key={index}>{paint(child as never)}</span>
        ))}
      </span>
    );
  }
  if (node.type === "root") {
    return (node.children ?? []).map((child, index) => <span key={index}>{paint(child as never)}</span>);
  }
  return null;
}

export function MarkdownView({
  markdown,
  resolveImage,
  onOpenDoc,
  onOpenCard,
  onToggleTask,
}: {
  markdown: string;
  resolveImage?: (src: string) => string | undefined;
  onOpenDoc?: (title: string) => void;
  onOpenCard?: (title: string) => void;
  onToggleTask?: (cardId: string | undefined, checked: boolean, text: string) => void;
}) {
  const source = useMemo(() => linkifyWiki(markdown), [markdown]);
  const [diagrams, setDiagrams] = useState<Record<string, string>>({});
  useEffect(() => {
    const blocks = [...markdown.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((match) => match[1]);
    if (!blocks.length) return;
    let cancelled = false;
    void import("mermaid").then(async (mod) => {
      const mermaid = mod.default;
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral" });
      const next: Record<string, string> = {};
      for (const [index, block] of blocks.entries()) {
        try {
          const rendered = await mermaid.render("sreda-mermaid-" + index + "-" + block.length, block);
          next[block] = rendered.svg;
        } catch {
          next[block] = "";
        }
      }
      if (!cancelled) setDiagrams(next);
    });
    return () => {
      cancelled = true;
    };
  }, [markdown]);
  return (
    <article className="md-view">
      <Markdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith("sreda-doc:")) {
              const title = decodeURIComponent(href.slice("sreda-doc:".length));
              return (
                <button type="button" className="md-link" onClick={() => onOpenDoc?.(title)}>
                  {children}
                </button>
              );
            }
            if (href?.startsWith("sreda-card:")) {
              const title = decodeURIComponent(href.slice("sreda-card:".length));
              return (
                <button type="button" className="md-link" onClick={() => onOpenCard?.(title)}>
                  {children}
                </button>
              );
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
          img: ({ src, alt }) => {
            const resolved = src?.startsWith("sreda-attachment:") ? resolveImage?.(src) ?? "" : src;
            if (!resolved) return null;
            return <img src={resolved} alt={alt ?? ""} />;
          },
          input: ({ type, checked, ...props }) => {
            if (type !== "checkbox") return <input type={type} checked={checked} {...props} />;
            return (
              <input
                type="checkbox"
                checked={!!checked}
                onChange={(event) => onToggleTask?.(undefined, event.target.checked, "")}
              />
            );
          },
          blockquote: ({ children }) => {
            const raw = textOf(children);
            const kind = /\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]/i.exec(raw)?.[1]?.toLowerCase();
            return <blockquote className={kind ? "callout callout-" + kind : undefined}>{children}</blockquote>;
          },
          code: ({ className, children }) => {
            const text = String(children ?? "").replace(/\n$/, "");
            const lang = /language-([\w-]+)/.exec(className ?? "")?.[1];
            if (lang === "mermaid") {
              const svg = diagrams[text];
              return svg ? (
                <div className="mermaid-block" dangerouslySetInnerHTML={{ __html: svg }} />
              ) : (
                <pre className="md-code">
                  <code>{text}</code>
                </pre>
              );
            }
            if (!className) return <code>{children}</code>;
            let tree;
            try {
              tree = lang && lowlight.registered(lang) ? lowlight.highlight(lang, text) : lowlight.highlightAuto(text);
            } catch {
              tree = null;
            }
            return (
              <pre className="md-code">
                <code>{tree ? paint(tree as never) : text}</code>
              </pre>
            );
          },
        }}
      >
        {source || "*Документ пока пуст.*"}
      </Markdown>
    </article>
  );
}
