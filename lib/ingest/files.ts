import { IngestError } from "./limits";


export type ImportFileKind = "pdf" | "docx" | "markdown" | "text";

export const MAX_UPLOAD_BYTES = 4_000_000;
export const MAX_UPLOAD_LABEL = "4 MB";

const KIND_BY_EXTENSION: Record<string, ImportFileKind> = {
  pdf: "pdf",
  docx: "docx",
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  txt: "text",
  text: "text",
};

const KIND_BY_MIME: Record<string, ImportFileKind> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/markdown": "markdown",
  "text/plain": "text",
};

export function detectFileKind(filename: string, mimeType?: string | null): ImportFileKind | null {
  const ext = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (ext && KIND_BY_EXTENSION[ext]) return KIND_BY_EXTENSION[ext];
  if (mimeType) {
    const bare = mimeType.split(";")[0].trim().toLowerCase();
    if (KIND_BY_MIME[bare]) return KIND_BY_MIME[bare];
  }
  return null;
}

export async function extractFileText(kind: ImportFileKind, data: Uint8Array): Promise<string> {
  if (kind === "pdf") {
    try {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(data));
      const { text } = await extractText(pdf, { mergePages: true });
      return text.trim();
    } catch {
      throw new IngestError("Couldn't read that PDF — it may be corrupted, encrypted, or image-only.");
    }
  }
  if (kind === "docx") {
    try {
      const mammoth = (await import("mammoth")).default;
      const { value } = await mammoth.extractRawText({ buffer: Buffer.from(data) });
      return value.trim();
    } catch {
      throw new IngestError("Couldn't read that DOCX file — it may be corrupted or an older .doc format.");
    }
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(data).trim();
}

export function titleFromFilename(filename: string): string {
  return filename.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim();
}
