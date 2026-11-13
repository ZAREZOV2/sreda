import { useEffect, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  syntaxHighlighting,
  defaultHighlightStyle,
} from "@codemirror/language";
import { useEditor, EditorContent } from "@tiptap/react";
import { blockSnippets } from "./text";
import { documentExtensions, markdownOf } from "./editorExtensions";

export type EditorMode = "visual" | "source";

export function MarkdownEditor({
  value,
  onChange,
  mode,
  onPasteImage,
}: {
  value: string;
  onChange: (value: string) => void;
  mode: EditorMode;
  onPasteImage?: (file: File) => Promise<string | null>;
}) {
  const [menu, setMenu] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    if (mode !== "source" || !host.current) return;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          history(),
          syntaxHighlighting(defaultHighlightStyle),
          markdown(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged)
              onChangeRef.current(update.state.doc.toString());
          }),
          EditorView.domEventHandlers({
            paste(event) {
              const file = [...(event.clipboardData?.files ?? [])].find(
                (item) => item.type.startsWith("image/"),
              );
              if (!file || !onPasteImage) return false;
              event.preventDefault();
              void onPasteImage(file).then((url) => {
                if (!url) return;
                const current = viewRef.current;
                if (!current) return;
                current.dispatch(current.state.replaceSelection(`![](${url})`));
              });
              return true;
            },
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Recreate when entering source mode. External value changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
  useEffect(() => {
    const view = viewRef.current;
    if (!view || mode !== "source") return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value, mode]);
  const editorRef = useRef<ReturnType<typeof useEditor>>(null);
  const editor = useEditor(
    {
      extensions: documentExtensions(),
      shouldRerenderOnTransaction: true,
      content: value,
      editorProps: {
        attributes: { class: "md-visual", "aria-label": "Визуальный редактор" },
        handlePaste(_view, event) {
          const file = [...(event.clipboardData?.files ?? [])].find((item) =>
            item.type.startsWith("image/"),
          );
          if (!file || !onPasteImage) return false;
          void onPasteImage(file).then((url) => {
            if (url)
              editorRef.current?.chain().focus().setImage({ src: url }).run();
          });
          return true;
        },
      },
      onUpdate: ({ editor: current }) => {
        const markdown = markdownOf(current);
        onChangeRef.current(markdown);
      },
    },
    [mode],
  );
  editorRef.current = editor;
  useEffect(() => {
    if (!editor || mode !== "visual") return;
    const current = markdownOf(editor);
    if (current !== value)
      editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value, mode]);
  const insert = (snippet: string) => {
    setMenu(false);
    if (mode === "source") {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch(view.state.replaceSelection(snippet));
      view.focus();
      return;
    }
    editor?.chain().focus().insertContent(snippet).run();
  };
  return (
    <div className="md-editor">
      <div className="md-editor-tools">
        <button
          type="button"
          className="text-link"
          onClick={() => setMenu((open) => !open)}
          aria-expanded={menu}
        >
          / Блок
        </button>
        {menu && (
          <div className="block-menu" role="menu">
            {blockSnippets.map((block) => (
              <button
                key={block.id}
                type="button"
                role="menuitem"
                onClick={() => insert(block.insert)}
              >
                {block.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {mode === "source" ? (
        <div ref={host} className="cm-host" />
      ) : (
        <EditorContent editor={editor} />
      )}
    </div>
  );
}
