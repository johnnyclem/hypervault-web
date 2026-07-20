"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const JSX_FILENAME_RE = /\.(jsx|tsx)$/i;

type SaveResult = {
  url: string;
  slug: string;
  is_jsx: boolean;
  message: string;
};

export function NewArtifactForm() {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [connectTo, setConnectTo] = useState("");
  const [sourcePrompt, setSourcePrompt] = useState("");
  const [forceHtml, setForceHtml] = useState(false);
  const [makePwa, setMakePwa] = useState(true);
  const [isPrivate, setIsPrivate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SaveResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("source_prompt");
    if (fromUrl) setSourcePrompt(fromUrl);
  }, []);

  async function handleJsxFile(file: File) {
    const text = await file.text();
    setContent(text);
    setFileName(file.name);
    if (!title.trim()) setTitle(file.name.replace(JSX_FILENAME_RE, ""));
    setResult(null);
    setError(null);
  }

  async function save() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title || "Untitled",
          content,
          connect_to: connectTo
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          make_pwa: makePwa,
          force_html: forceHtml,
          visibility: isPrivate ? "private" : "public",
          source_prompt: sourcePrompt.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Saving failed — try again.");
        return;
      }
      setResult(data);
    } catch {
      setError("Network hiccup — your artifact is safe in the textbox, try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label htmlFor="hv-title" className="text-sm font-medium">
          Title
        </label>
        <Input
          id="hv-title"
          placeholder="My glorious AI dashboard"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="hv-content" className="text-sm font-medium">
            Paste from chat
          </label>
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".jsx,.tsx"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleJsxFile(f);
              }}
            />
            <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
              Import .jsx file
            </Button>
          </div>
        </div>
        <Textarea
          id="hv-content"
          className="min-h-[280px] font-mono text-xs"
          placeholder="Paste HTML or a React/JSX component — we'll figure out which and make it work."
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            setFileName(null);
          }}
        />
        {fileName && <p className="text-xs text-muted-foreground">Loaded from {fileName} — review, then save.</p>}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="hv-source-prompt" className="text-sm font-medium">
          Source prompt <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <Textarea
          id="hv-source-prompt"
          className="min-h-[80px] text-xs"
          placeholder="The prompt that created this — saved into the page so any AI can pick up where you left off."
          value={sourcePrompt}
          onChange={(e) => setSourcePrompt(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="hv-connect" className="text-sm font-medium">
          Connect to <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <Input
          id="hv-connect"
          placeholder="Titles or slugs of related artifacts, comma-separated"
          value={connectTo}
          onChange={(e) => setConnectTo(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Links show up as edges in your vault&apos;s graph view. Similar items get connected automatically too.
        </p>
      </div>

      <div className="flex flex-col gap-2 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isPrivate}
            onChange={(e) => setIsPrivate(e.target.checked)}
            className="h-4 w-4 accent-[var(--primary)]"
          />
          <span>
            Keep it private{" "}
            <span className="text-muted-foreground">
              — only you and people you invite can open the link (you can flip this anytime)
            </span>
          </span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={makePwa}
            onChange={(e) => setMakePwa(e.target.checked)}
            className="h-4 w-4 accent-[var(--primary)]"
          />
          Make it installable (Add to Home Screen)
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={forceHtml}
            onChange={(e) => setForceHtml(e.target.checked)}
            className="h-4 w-4 accent-[var(--primary)]"
          />
          Force plain HTML (skip React/JSX auto-detection)
        </label>
      </div>

      <Button size="lg" onClick={save} disabled={busy || !content.trim()}>
        {busy ? "Beaming it into your vault…" : "Save to my vault"}
      </Button>

      {result && (
        <div className="rounded-xl border border-accent/50 bg-accent/10 p-4 text-sm" role="status">
          <p className="font-semibold text-accent">{result.message}</p>
          <p className="mt-2">
            <a href={result.url} target="_blank" rel="noreferrer" className="font-mono underline underline-offset-4">
              {result.url}
            </a>
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
