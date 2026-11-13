import { invoke } from "@tauri-apps/api/core";
import { desktop } from "./persistence";

export type Document = {
  id: string;
  title: string;
  markdown: string;
  revision: number;
};
const preview = new Map<string, Document>();
export async function listDocuments(): Promise<Document[]> {
  return desktop
    ? invoke("documents_list")
    : structuredClone([...preview.values()]);
}
export async function saveDocument(document: Document): Promise<number> {
  if (desktop) return invoke("documents_save", { document });
  if ((preview.get(document.id)?.revision ?? 0) !== document.revision)
    throw Error("Конфликт версий документа");
  const revision = document.revision + 1;
  preview.set(document.id, { ...document, revision });
  return revision;
}
