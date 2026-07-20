"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { extractConversationsFromZip, type ZipExtractionStats } from "@/lib/imports/zip";
import { chunkImportPayload } from "@/lib/imports/chunk";

type ImportResult = {
  platform: string;
  imported: number;
  skipped: number;
  messages: number;
  message: string;
};

const PLATFORM_OPTIONS = [
  { value: "", label: "Auto-detect" },
  { value: "chatgpt", label: "ChatGPT (OpenAI export)" },
  { value: "claude", label: "Claude (Anthropic export)" },
  { value: "gemini", label: "Gemini (Google Takeout)" },
  { value: "grok", label: "Grok (X archive)" },
];

export function ImportForm() {
  const [platform, setPlatform] = useState("");
  const [pasted, setPasted] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileData, setFileData] = useState<string | null>(null);
  const [zipStats, setZipStats] = useState<ZipExtractionStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [unzipping, setUnzipping] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setResult(null);
    setZipStats(null);

    if (file.name.toLowerCase().endsWith(".zip")) {
      setFileName(file.name);
      setUnzipping(true);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const { data, stats } = await extractConversationsFromZip(bytes);
        if (!data) {
          setError(
            `Couldn't find a conversation export inside ${file.name} — scanned ${stats.jsonEntries} JSON file(s) in the archive but none held any conversations.`
          );
          setFileName(null);
          return;
        }
        setFileData(data);
        setZipStats(stats);
      } catch {
        setError("Couldn't read that zip file — it may be corrupt. Try re-downloading the export.");
        setFileName(null);
      } finally {
        setUnzipping(false);
      }
      return;
    }

    setFileName(file.name);
    setFileData(await file.text());
  }

  async function runImport() {
    const data = fileData ?? pasted;
    if (!data.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      // Large exports (Grok/X account dumps especially) can blow past the
      // ~4.5MB request body limit Vercel enforces on serverless functions,
      // so oversized payloads go out as several smaller sequential imports.
      const chunks = chunkImportPayload(data);
      let imported = 0;
      let skipped = 0;
      let messages = 0;
      let lastJson: ImportResult | null = null;

      for (let i = 0; i < chunks.length; i++) {
        if (chunks.length > 1) setProgress(`Importing batch ${i + 1} of ${chunks.length}…`);
        const res = await fetch("/api/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: chunks[i], platform: platform || undefined }),
        });
        const json = await res.json();
        if (!res.ok) {
          setError(
            imported > 0
              ? `Imported ${imported} conversation${imported === 1 ? "" : "s"} before hitting an error: ${json.error ?? "import failed"}`
              : (json.error ?? "Import failed — try again.")
          );
          return;
        }
        imported += json.imported;
        skipped += json.skipped;
        messages += json.messages;
        lastJson = json;
      }

      setResult(
        chunks.length > 1 && lastJson
          ? {
              ...lastJson,
              imported,
              skipped,
              messages,
              message: `Imported ${imported} conversation${imported === 1 ? "" : "s"} (${messages} messages) from ${lastJson.platform} across ${chunks.length} batches. Open /chat to continue them on any backend.`,
            }
          : lastJson
      );
      setPasted("");
      setFileData(null);
      setFileName(null);
      setZipStats(null);
    } catch {
      setError("Network hiccup — your export is safe locally, try again.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label htmlFor="hv-import-platform" className="text-sm font-medium">
          Platform
        </label>
        <select
          id="hv-import-platform"
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          className="h-10 w-full rounded-md border bg-transparent px-3 text-sm"
        >
          {PLATFORM_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="hv-import-file" className="text-sm font-medium">
          Export file
        </label>
        <input
          id="hv-import-file"
          type="file"
          accept=".json,.txt,.md,.zip"
          onChange={(e) => onFile(e.target.files?.[0])}
          className="text-sm"
        />
        <p className="text-xs text-muted-foreground">
          Full data-export zips work too (Grok/X archives can run a few hundred
          MB) — the conversation JSON is unzipped in your browser and only
          that gets sent; image attachments inside the zip aren&apos;t
          imported yet.
        </p>
        {fileName && !zipStats && (
          <p className="text-xs text-muted-foreground">
            Loaded <span className="font-mono">{fileName}</span> — ready to import.
          </p>
        )}
        {fileName && zipStats && (
          <p className="text-xs text-muted-foreground">
            Found <span className="font-mono">{zipStats.matchedEntryName}</span> inside{" "}
            <span className="font-mono">{fileName}</span> — ready to import.
            {zipStats.imageEntries > 0 &&
              ` (${zipStats.imageEntries} image file${zipStats.imageEntries === 1 ? "" : "s"} in the archive skipped for now.)`}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="hv-import-paste" className="text-sm font-medium">
          …or paste a transcript{" "}
          <span className="font-normal text-muted-foreground">(mobile-app fallback)</span>
        </label>
        <Textarea
          id="hv-import-paste"
          className="min-h-[180px] font-mono text-xs"
          placeholder={"User: how do I center a div\nAssistant: with flexbox — …"}
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          disabled={Boolean(fileData)}
        />
      </div>

      <Button size="lg" onClick={runImport} disabled={busy || unzipping || !(fileData ?? pasted).trim()}>
        {unzipping
          ? "Unzipping your export…"
          : busy
            ? (progress ?? "Reconstructing your threads…")
            : "Import into my vault"}
      </Button>

      {result && (
        <div className="rounded-xl border border-accent/50 bg-accent/10 p-4 text-sm" role="status">
          <p className="font-semibold text-accent">{result.message}</p>
          <p className="mt-1 text-muted-foreground">
            {result.imported} imported · {result.skipped} skipped · {result.messages} messages
          </p>
        </div>
      )}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
