"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Square, Volume2 } from "lucide-react";
import { speak, type SpeakHandle, type SpeakState } from "@/lib/tts/pocket-tts";

export function SpeakButton({ text }: { text: string }) {
  const [status, setStatus] = useState<SpeakState>({ state: "idle" });
  const handle = useRef<SpeakHandle | null>(null);

  useEffect(() => () => handle.current?.stop(), []);

  function onClick() {
    if (status.state === "idle") {
      handle.current = speak(text, setStatus);
    } else {
      handle.current?.stop();
    }
  }

  const label =
    status.state === "idle"
      ? "Read aloud"
      : status.state === "playing"
        ? "Stop reading"
        : "Cancel";

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        title={label}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {status.state === "idle" ? (
          <Volume2 className="h-4 w-4" />
        ) : status.state === "playing" ? (
          <Square className="h-3 w-3 fill-current" />
        ) : (
          <Loader2 className="h-4 w-4 animate-spin" />
        )}
      </button>
      {status.state === "loading" && (
        <span className="text-[10px] text-muted-foreground">
          {status.percent != null
            ? `Downloading voice model… ${status.percent}%`
            : "Loading voice…"}
        </span>
      )}
      {status.state === "generating" && (
        <span className="text-[10px] text-muted-foreground">Preparing audio…</span>
      )}
      {status.state === "idle" && status.error && (
        <span className="text-[10px] text-destructive">{status.error}</span>
      )}
    </div>
  );
}
