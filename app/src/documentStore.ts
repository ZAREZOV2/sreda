import { invoke } from "@tauri-apps/api/core";
import { desktop } from "./persistence";

export type Document = {
  id: string;
  title: string;
  markdown: string;
  revision: number;
  folderId?: string | null;
  linkedCardId?: string | null;
  updatedAt?: number;
};

export type Folder = {
  id: string;
  name: string;
  parentId?: string | null;
  revision: number;
};

export type DocRevision = {
  id: number;
  title: string;
  markdown: string;
  createdAt: number;
};

export type SearchHit = {
  kind: "doc" | "card";
  id: string;
  title: string;
  snippet: string;
  boardId?: string | null;
};

const preview = new Map<string, Document>();
const folders = new Map<string, Folder>();
const history = new Map<string, DocRevision[]>();

export async function listDocuments(): Promise<Document[]> {
  return desktop ? invoke("documents_list") : structuredClone([...preview.values()]);
}

export async function saveDocument(document: Document): Promise<number> {
  if (desktop) return invoke("documents_save", { document });
  if ((preview.get(document.id)?.revision ?? 0) !== document.revision)
    throw Error("Конфликт версий документа");
  const revision = document.revision + 1;
  const stored = { ...document, revision, updatedAt: Date.now() };
  preview.set(document.id, stored);
  const past = history.get(document.id) ?? [];
  past.push({
    id: past.length + 1,
    title: stored.title,
    markdown: stored.markdown,
    createdAt: stored.updatedAt ?? Date.now(),
  });
  history.set(document.id, past.slice(-40));
  return revision;
}

export async function listFolders(): Promise<Folder[]> {
  return desktop ? invoke("documents_folders") : structuredClone([...folders.values()]);
}

export async function saveFolder(folder: Folder): Promise<number> {
  if (desktop) return invoke("documents_folder_save", { folder });
  const revision = folder.revision + 1;
  folders.set(folder.id, { ...folder, revision });
  return revision;
}

export async function deleteFolder(id: string): Promise<void> {
  if (desktop) return invoke("documents_folder_delete", { id });
  folders.delete(id);
  for (const doc of preview.values()) {
    if (doc.folderId === id) preview.set(doc.id, { ...doc, folderId: null });
  }
}

export async function documentHistory(id: string): Promise<DocRevision[]> {
  return desktop ? invoke("documents_history", { id }) : structuredClone(history.get(id) ?? []);
}

export async function searchText(query: string): Promise<SearchHit[]> {
  if (desktop) return invoke("search_text", { query });
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];
  const hits: SearchHit[] = [];
  for (const doc of preview.values()) {
    const hay = (doc.title + "\n" + doc.markdown).toLowerCase();
    const at = hay.indexOf(needle);
    if (at === -1) continue;
    hits.push({
      kind: "doc",
      id: doc.id,
      title: doc.title,
      snippet: doc.markdown.slice(Math.max(0, at - 24), at + 48),
    });
  }
  return hits;
}

export async function putAttachment(
  docId: string,
  mime: string,
  name: string,
  bytes: Uint8Array,
): Promise<string> {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  const bytesBase64 = btoa(binary);
  if (desktop) return invoke("documents_attachment_put", { docId, mime, name, bytesBase64 });
  const id = "att-" + crypto.randomUUID();
  sessionStorage.setItem("sreda-att:" + id, JSON.stringify({ mime, bytesBase64 }));
  return id;
}

export async function getAttachment(id: string): Promise<{ mime: string; base64: string } | null> {
  if (desktop) return invoke("documents_attachment_get", { id });
  const raw = sessionStorage.getItem("sreda-att:" + id);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as { mime: string; bytesBase64: string };
  return { mime: parsed.mime, base64: parsed.bytesBase64 };
}

export async function importDocumentCopies(
  documents: Document[],
  nextFolders: Folder[] = [],
): Promise<number> {
  if (desktop)
    return invoke("documents_import_copies", { documents, folders: nextFolders });
  const map = new Map<string, string>();
  for (const folder of nextFolders) {
    const id = crypto.randomUUID();
    map.set(folder.id, id);
    folders.set(id, { ...folder, id, parentId: null, revision: 1 });
  }
  let count = 0;
  for (const document of documents) {
    const id = crypto.randomUUID();
    preview.set(id, {
      ...document,
      id,
      revision: 1,
      folderId: document.folderId ? map.get(document.folderId) ?? null : null,
      linkedCardId: null,
    });
    count += 1;
  }
  return count;
}

export async function backupBundle(): Promise<{ documents: Document[]; folders: Folder[] }> {
  if (desktop) return invoke("documents_backup");
  return {
    documents: structuredClone([...preview.values()]),
    folders: structuredClone([...folders.values()]),
  };
}
