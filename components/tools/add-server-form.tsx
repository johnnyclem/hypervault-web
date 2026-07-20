"use client";

import { useState } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AddCandidate } from "@/components/tools/types";

type HeaderRow = { key: string; value: string };

export function AddServerForm({ onInspect }: { onInspect: (candidate: AddCandidate) => void }) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [headers, setHeaders] = useState<HeaderRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const trimmed = url.trim();
    if (!trimmed) return;
    if (!/^https?:\/\/.+/.test(trimmed)) {
      setError("Enter an absolute http(s) URL.");
      return;
    }
    setError(null);
    const headerObject = Object.fromEntries(
      headers.filter((h) => h.key.trim() && h.value.trim()).map((h) => [h.key.trim(), h.value.trim()])
    );
    onInspect({
      url: trimmed,
      name: name.trim() || undefined,
      headers: Object.keys(headerObject).length > 0 ? headerObject : undefined,
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://mcp.example.com/mcp"
          aria-label="MCP server URL"
          className="flex-1"
        />
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (optional)"
          aria-label="Server name"
          className="sm:w-48"
        />
      </div>
      {headers.map((h, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            value={h.key}
            onChange={(e) => setHeaders(headers.map((row, j) => (j === i ? { ...row, key: e.target.value } : row)))}
            placeholder="Header (e.g. Authorization)"
            aria-label="Header name"
            className="flex-1"
          />
          <Input
            type="password"
            value={h.value}
            onChange={(e) => setHeaders(headers.map((row, j) => (j === i ? { ...row, value: e.target.value } : row)))}
            placeholder="Value"
            aria-label="Header value"
            className="flex-1"
          />
          <button
            onClick={() => setHeaders(headers.filter((_, j) => j !== i))}
            aria-label="Remove header"
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button onClick={submit} disabled={!url.trim()} size="sm" className="gap-1.5">
          <Search className="h-3.5 w-3.5" /> Inspect &amp; add
        </Button>
        <button
          onClick={() => setHeaders([...headers, { key: "", value: "" }])}
          className="text-xs text-muted-foreground underline-offset-4 hover:underline"
        >
          + auth header
        </button>
      </div>
    </div>
  );
}
