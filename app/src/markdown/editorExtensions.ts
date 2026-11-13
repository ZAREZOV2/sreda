import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { Link } from "@tiptap/extension-link";
import { Image } from "@tiptap/extension-image";

export function markdownOf(editor: { storage: object }): string {
  const storage = editor.storage as {
    markdown?: { getMarkdown?: () => string };
  };
  return storage.markdown?.getMarkdown?.() ?? "";
}

/** Расширения визуального редактора. Тест кругового Markdown использует тот же набор. */
export function documentExtensions() {
  return [
    StarterKit.configure({ link: false, underline: false, listKeymap: false }),
    Markdown.configure({ html: false, transformPastedText: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    TaskList,
    TaskItem.configure({ nested: true }),
    Link.configure({ openOnClick: false }),
    Image,
  ];
}

export function openDocumentEditor(content: string) {
  return new Editor({
    extensions: documentExtensions(),
    content,
  });
}
