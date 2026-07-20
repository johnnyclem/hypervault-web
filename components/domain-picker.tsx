"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { domainPortfolio, validateSubdomain } from "@/lib/domains";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Availability =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available" }
  | { state: "unavailable"; reason: string };

export function DomainPicker({ signedIn, initialName = "" }: { signedIn: boolean; initialName?: string }) {
  const router = useRouter();
  const portfolio = useMemo(() => domainPortfolio(), []);
  const [base, setBase] = useState(portfolio.find((d) => d.available)?.domain ?? "vault.cool");
  const [name, setName] = useState(initialName);
  const [availability, setAvailability] = useState<Availability>({ state: "idle" });
  const [status, setStatus] = useState<{ kind: "idle" | "busy" | "done" | "error"; message?: string }>({
    kind: "idle",
  });

  const preview = `${name || "you"}.${base}`;

  useEffect(() => {
    if (!name) {
      setAvailability({ state: "idle" });
      return;
    }
    const validation = validateSubdomain(name);
    if (!validation.ok) {
      setAvailability({ state: "unavailable", reason: validation.error });
      return;
    }

    setAvailability({ state: "checking" });
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/claim-domain?name=${encodeURIComponent(name)}&base=${encodeURIComponent(base)}`,
          { signal: controller.signal }
        );
        const data = await res.json();
        if (!res.ok) return;
        setAvailability(
          data.available
            ? { state: "available" }
            : { state: "unavailable", reason: data.reason ?? "That name is taken." }
        );
      } catch {
      }
    }, 350);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [name, base]);

  async function claim() {
    if (!signedIn) {
      router.push("/login");
      return;
    }
    setStatus({ kind: "busy" });
    try {
      const res = await fetch("/api/claim-domain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ desired_name: name, base_domain: base }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus({ kind: "error", message: data.error ?? "That didn't work — try another name." });
        return;
      }
      setStatus({ kind: "done", message: `${data.domain} is yours! 🎉` });
      router.refresh();
    } catch {
      setStatus({ kind: "error", message: "Network hiccup — give it another shot." });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {portfolio.map((d) => {
          const selected = base === d.domain;
          return (
            <button
              key={d.domain}
              type="button"
              disabled={!d.available}
              onClick={() => setBase(d.domain)}
              aria-pressed={selected}
              className={cn(
                "rounded-xl border p-4 text-left transition-colors",
                selected ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/50",
                !d.available && "cursor-not-allowed opacity-50"
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono font-semibold">{d.domain}</span>
                {d.featured && <Badge variant="accent">Featured</Badge>}
                {!d.available && <Badge variant="secondary">Coming soon</Badge>}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{d.tagline}</p>
              {d.available && (
                <p className={cn("mt-3 font-mono text-sm", selected ? "text-primary" : "text-muted-foreground")}>
                  {name || "you"}.{d.domain}
                </p>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="hv-subdomain" className="text-sm font-medium">
          Pick your name
        </label>
        <div className="flex items-center gap-2">
          <Input
            id="hv-subdomain"
            placeholder="nova"
            value={name}
            onChange={(e) => setName(e.target.value.toLowerCase())}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <span className="whitespace-nowrap font-mono text-sm text-muted-foreground">.{base}</span>
        </div>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {availability.state === "checking" && (
            <>
              Checking <span className="font-mono">{preview}</span>…
            </>
          )}
          {availability.state === "available" && (
            <span className="text-accent">
              ✓ <span className="font-mono">{preview}</span> is available!
            </span>
          )}
          {availability.state === "unavailable" && (
            <span className="text-destructive">{availability.reason}</span>
          )}
          {availability.state === "idle" && (
            <>
              Your realm will live at <span className="font-mono text-accent">{preview}</span>
            </>
          )}
        </p>
      </div>

      <Button
        size="lg"
        onClick={claim}
        disabled={status.kind === "busy" || !name || availability.state === "unavailable"}
      >
        {status.kind === "busy" ? "Claiming your realm…" : "Claim my realm & upgrade"}
      </Button>

      {status.kind === "done" && (
        <p className="text-sm font-medium text-accent" role="status">
          {status.message}{" "}
          <a href={`https://${name}.${base}`} className="underline underline-offset-4">
            Visit it →
          </a>
        </p>
      )}
      {status.kind === "error" && (
        <p className="text-sm text-destructive" role="alert">
          {status.message}
        </p>
      )}
    </div>
  );
}
