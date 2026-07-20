"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, type ButtonProps } from "@/components/ui/button";

export type JsxImportResult = {
  url: string;
  slug: string;
  is_jsx: boolean;
  duplicate?: boolean;
  visibility?: string;
  message: string;
};

const ACCEPT = ".jsx,.tsx";
const FILENAME_RE = /\.(jsx|tsx)$/i;

export function JsxImportButton({
  label = "Import .jsx",
  variant = "outline",
  size = "sm",
  className,
  tags,
  sourcePrompt,
  onSaved,
  onError,
  refreshOnSave = false,
  showResult = true,
}: {
  label?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
  tags?: string[];
  sourcePrompt?: string;
  onSaved?: (result: JsxImportResult, fileName: string) => void;
  onError?: (message: string) => void;
  refreshOnSave?: boolean;
  showResult?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<JsxImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    if (!FILENAME_RE.test(file.name)) {
      const message = "Pick a .jsx or .tsx file.";
      setError(message);
      onError?.(message);
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const content = await file.text();
      const title = file.name.replace(FILENAME_RE, "");
      const res = await fetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          content,
          type: "jsx",
          tags,
          source_prompt: sourcePrompt,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const message = data.error ?? "Import failed — try again.";
        setError(message);
        onError?.(message);
        return;
      }
      setResult(data);
      onSaved?.(data, file.name);
      if (refreshOnSave) router.refresh();
    } catch {
      const message = "Network hiccup — try again.";
      setError(message);
      onError?.(message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        onClick={() => inputRef.current?.click()}
        disabled={busy}
      >
        {busy ? "Importing…" : label}
      </Button>
      {showResult && result && (
        <div className="text-xs" role="status">
          <span className="text-accent">
            {result.duplicate ? "Already in your vault — here's its link." : "Imported!"}
          </span>{" "}
          <a href={result.url} target="_blank" rel="noreferrer" className="font-mono underline underline-offset-4">
            {result.url}
          </a>
        </div>
      )}
      {showResult && error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
