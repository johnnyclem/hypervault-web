"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AGENTS,
  PERSON,
  RuleError,
  approvalSummary,
  approve,
  assertTb,
  assertUv,
  chainLines,
  contextBlock,
  docket,
  emptyLedger,
  fold,
  markerFor,
  refute,
  story,
  strike,
  trace,
  warnings,
  type Actor,
  type Entry,
  type Folded,
  type Ledger,
  type TraceNode,
} from "@/lib/truth-demo/ledger";

const ACTORS: Actor[] = [PERSON, ...AGENTS];
const STORY = story();

/** How a status reads to a person (contested is "under appeal", as the spec puts it). */
export function statusLabel(status: string): string {
  return status === "contested" ? "under appeal" : status;
}

function shortId(id: string): string {
  return id.slice(6, 16).replace(/^0+/, "") || "0";
}

type Props = {
  /** The landing spotlight: the story, the ledger and what the model sees. The full playground adds the rest. */
  variant?: "full" | "spotlight";
};

export function TruthPlayground({ variant = "full" }: Props) {
  const [ledger, setLedger] = useState<Ledger>(emptyLedger);
  const [actor, setActor] = useState<Actor>(PERSON);
  const [played, setPlayed] = useState(0);
  const [notice, setNotice] = useState<{ kind: "rule" | "ok"; text: string } | null>(null);
  const [contesting, setContesting] = useState<string | null>(null);
  const full = variant === "full";

  /** Run a write under the rules; a refusal is the point, so it is shown, not swallowed. */
  const act = (label: string, run: (l: Ledger) => Ledger | { ledger: Ledger; status: string; missing: string[] }) => {
    try {
      const out = run(ledger);
      if ("ledger" in out && "status" in out) {
        setLedger(out.ledger);
        const tail = out.status === "promoted" ? "promoted to a TB, signed by you." : out.status === "nominated" ? "nominated: corroborated by three agent sessions, first on your docket, still a UV." : `recorded. Still missing: ${out.missing.join(", ")}.`;
        setNotice({ kind: "ok", text: `${label}: ${tail}` });
      } else {
        setLedger(out);
        setNotice({ kind: "ok", text: `${label}.` });
      }
    } catch (err) {
      if (err instanceof RuleError) setNotice({ kind: "rule", text: err.message });
      else throw err;
    }
  };

  const playNext = () => {
    const step = STORY[played];
    if (!step) return;
    act(step.title, step.run);
    setPlayed(played + 1);
  };

  const reset = () => {
    setLedger(emptyLedger());
    setPlayed(0);
    setNotice(null);
    setContesting(null);
  };

  const block = contextBlock(ledger);

  return (
    <div className="flex flex-col gap-6" data-testid="truth-playground">
      <Card className="lp-card">
        <CardContent className="flex flex-col gap-4 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="lp-display font-semibold">Play the story</h3>
              <p className="text-sm text-muted-foreground">Nine acts, every rule. Or pick an identity below and write your own.</p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" className="lp-btn" onClick={playNext} disabled={played >= STORY.length}>
                {played === 0 ? "Start" : played >= STORY.length ? "The end" : `Next act (${played + 1}/${STORY.length})`}
              </Button>
              <Button size="sm" variant="outline" className="lp-btn shadow-none" onClick={reset} disabled={ledger.lines.length === 0}>
                Reset
              </Button>
            </div>
          </div>
          <ol className="grid gap-1 text-sm sm:grid-cols-3">
            {STORY.map((s, i) => (
              <li key={s.title} className={i < played ? "text-foreground" : "text-muted-foreground"}>
                <span className="font-mono text-xs">{i + 1}.</span> {s.title}
              </li>
            ))}
          </ol>
          {played > 0 && played <= STORY.length && (
            <p className="rounded-xl bg-primary/10 px-4 py-3 text-sm" data-testid="story-what">
              <span className="font-semibold">{STORY[played - 1].title}.</span> {STORY[played - 1].what}
            </p>
          )}
        </CardContent>
      </Card>

      {notice && (
        <div
          role="status"
          data-testid="notice"
          className={
            notice.kind === "rule"
              ? "rounded-xl border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm"
              : "rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground"
          }
        >
          {notice.kind === "rule" ? <span className="font-semibold">The rule said no. </span> : null}
          {notice.text}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Acting as</span>
        {ACTORS.map((a) => (
          <button
            key={a.name}
            type="button"
            onClick={() => setActor(a)}
            aria-pressed={actor.name === a.name}
            className={
              actor.name === a.name
                ? "lp-chip border border-primary/50 bg-primary/10 px-3 py-1 font-mono text-xs text-primary"
                : "lp-chip border border-border bg-card px-3 py-1 font-mono text-xs text-muted-foreground hover:text-foreground"
            }
          >
            {a.name}
            <span className="ml-1 opacity-70">{a.role === "human" ? "· person" : "· agent"}</span>
          </button>
        ))}
      </div>

      <div className={full ? "grid gap-6 lg:grid-cols-[3fr_2fr]" : "grid gap-6"}>
        <div className="flex flex-col gap-6">
          {full && <AssertForm ledger={ledger} actor={actor} contesting={contesting} setContesting={setContesting} act={act} />}
          <LedgerList ledger={ledger} actor={actor} act={act} onContest={(id) => setContesting(id)} full={full} />
        </div>
        <div className="flex flex-col gap-6">
          <Card className="lp-card">
            <CardContent className="pt-6">
              <h3 className="lp-display font-semibold">What the model sees</h3>
              <p className="mt-1 text-sm text-muted-foreground">The block a chat turn leads with: citable TBs, their appeals indented, then the open UVs.</p>
              <pre className="mt-3 overflow-x-auto rounded-xl bg-muted p-4 font-mono text-xs leading-relaxed" data-testid="context-block">
                {block.length ? block.join("\n") : "(nothing held yet)"}
              </pre>
            </CardContent>
          </Card>
          {full && <Docket ledger={ledger} />}
          {full && <WarnOnWrite ledger={ledger} />}
          {full && <Events ledger={ledger} />}
        </div>
      </div>

      {full && <Export ledger={ledger} />}
    </div>
  );
}

// ── writing ─────────────────────────────────────────────────────────────────

type Act = (label: string, run: (l: Ledger) => Ledger | { ledger: Ledger; status: string; missing: string[] }) => void;

function AssertForm({ ledger, actor, contesting, setContesting, act }: { ledger: Ledger; actor: Actor; contesting: string | null; setContesting: (id: string | null) => void; act: Act }) {
  const [kind, setKind] = useState<"TB" | "UV">("TB");
  const [text, setText] = useState("");
  const [basis, setBasis] = useState("");
  const [evidenceRef, setEvidenceRef] = useState("");
  const [dead, setDead] = useState("");
  const [subject, setSubject] = useState("");
  const [current, setCurrent] = useState("");
  const [premise, setPremise] = useState("");
  const [inference, setInference] = useState("");
  const effectiveKind = actor.role === "agent" ? "UV" : kind;
  useEffect(() => {
    if (contesting) setKind("UV");
  }, [contesting]);

  const tbs = ledger.entries.filter((e) => e.type === "TB" && ["active", "contested"].includes(fold(ledger, e.id).status));
  const premises = ledger.entries.filter((e) => fold(ledger, e.id).current);

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    const derives = premise ? [premise] : [];
    if (effectiveKind === "TB") {
      act(`TB asserted by ${actor.name}`, (l) =>
        assertTb(l, actor, {
          claim: text,
          evidence: evidenceRef.trim() ? [{ kind: "commit", ref: evidenceRef.trim() }] : undefined,
          literals: dead.trim() ? [{ dead: dead.trim(), subject: subject.trim() || undefined, current: current.trim() || undefined }] : undefined,
          derives,
          inference: inference || undefined,
        })
      );
    } else {
      act(`UV asserted by ${actor.name}`, (l) => assertUv(l, actor, { assertion: text, basis, contests: contesting, derives, inference: inference || undefined }));
    }
    setText("");
    setBasis("");
    setEvidenceRef("");
    setDead("");
    setSubject("");
    setCurrent("");
    setPremise("");
    setInference("");
    setContesting(null);
  };

  return (
    <Card className="lp-card">
      <CardContent className="pt-6">
        <form onSubmit={submit} className="flex flex-col gap-3" aria-label="assert">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="lp-display font-semibold">Write to the ledger</h3>
            <div className="flex gap-1">
              {(["TB", "UV"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  disabled={k === "TB" && actor.role === "agent"}
                  aria-pressed={effectiveKind === k}
                  title={k === "TB" && actor.role === "agent" ? "Nothing an agent writes is a TB." : undefined}
                  className={
                    effectiveKind === k
                      ? "lp-chip border border-primary/50 bg-primary/10 px-3 py-1 font-mono text-xs text-primary"
                      : "lp-chip border border-border px-3 py-1 font-mono text-xs text-muted-foreground disabled:opacity-40"
                  }
                >
                  {k === "TB" ? "TB · truth" : "UV · unverified"}
                </button>
              ))}
            </div>
          </div>
          {actor.role === "agent" && <p className="text-xs text-muted-foreground">Agents write UVs. A person promotes them in review.</p>}
          {contesting && (
            <p className="flex items-center justify-between rounded-lg bg-accent/15 px-3 py-2 text-xs">
              <span>
                Contesting TB {shortId(contesting)}: “{ledger.entries.find((e) => e.id === contesting)?.text}”
              </span>
              <button type="button" className="underline" onClick={() => setContesting(null)}>
                drop
              </button>
            </p>
          )}
          <Input aria-label={effectiveKind === "TB" ? "claim" : "assertion"} placeholder={effectiveKind === "TB" ? "The claim you stand behind" : "What you believe, not yet proven"} value={text} onChange={(e) => setText(e.target.value)} />
          {effectiveKind === "TB" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <Input aria-label="evidence" placeholder="Evidence (a commit, file or test)" value={evidenceRef} onChange={(e) => setEvidenceRef(e.target.value)} />
              <div className="grid grid-cols-3 gap-2">
                <Input aria-label="dead value" placeholder="Retires value" value={dead} onChange={(e) => setDead(e.target.value)} />
                <Input aria-label="subject" placeholder="of subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
                <Input aria-label="current value" placeholder="now" value={current} onChange={(e) => setCurrent(e.target.value)} />
              </div>
            </div>
          ) : (
            <Input aria-label="basis" placeholder="Basis: why you believe it" value={basis} onChange={(e) => setBasis(e.target.value)} />
          )}
          {premises.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2">
              <select aria-label="premise" className="h-10 rounded-xl border border-border bg-background px-3 text-sm" value={premise} onChange={(e) => setPremise(e.target.value)}>
                <option value="">Rests on nothing (no premise)</option>
                {premises.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.type} {shortId(p.id)} · {p.text}
                  </option>
                ))}
              </select>
              <Input aria-label="inference" placeholder="Inference: what follows from the premise" value={inference} onChange={(e) => setInference(e.target.value)} disabled={!premise} />
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {effectiveKind === "TB" ? `Signed by ${actor.name}, who answers for it.` : `Lands as [UV — UNVERIFIED]${tbs.length && !contesting ? " · pick “Contest” on a TB to appeal it" : ""}.`}
            </p>
            <Button type="submit" size="sm" className="lp-btn" disabled={!text.trim()}>
              Assert {effectiveKind}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ── the ledger ──────────────────────────────────────────────────────────────

function standingBadge(f: Folded) {
  if (f.standing === "sound") return null;
  return (
    <Badge variant={f.standing === "unsupported" ? "secondary" : "accent"} className="font-mono text-[10px]">
      {f.standing}
    </Badge>
  );
}

function LedgerList({ ledger, actor, act, onContest, full }: { ledger: Ledger; actor: Actor; act: Act; onContest: (id: string) => void; full: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const [opinion, setOpinion] = useState<Record<string, string>>({});
  const entries = [...ledger.entries].reverse();

  if (entries.length === 0) {
    return (
      <Card className="lp-card">
        <CardContent className="pt-6 text-sm text-muted-foreground">The ledger is empty. Start the story, or assert something as {actor.name}.</CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="ledger">
      <div className="flex items-center justify-between">
        <h3 className="lp-display font-semibold">The ledger</h3>
        <span className="font-mono text-xs text-muted-foreground">
          {ledger.entries.length} entr{ledger.entries.length === 1 ? "y" : "ies"} · {ledger.lines.length} lines appended
        </span>
      </div>
      {entries.map((e) => {
        const f = fold(ledger, e.id);
        const marker = markerFor(e, f);
        const isPerson = actor.role === "human";
        const openUv = e.type === "UV" && f.status === "open";
        const summary = openUv ? approvalSummary(ledger, e.id) : null;
        const t = open === e.id ? trace(ledger, e.id) : null;
        return (
          <Card key={e.id} className={`lp-card ${f.current ? "" : "opacity-70"}`} data-testid={`entry-${e.type}`}>
            <CardContent className="flex flex-col gap-3 pt-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-primary">{marker ?? `[${e.type} · ${statusLabel(f.status)}]`}</span>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {statusLabel(f.status)}
                    </Badge>
                    {standingBadge(f)}
                    {f.corroborated && (
                      <Badge variant="accent" className="font-mono text-[10px]">
                        nominated
                      </Badge>
                    )}
                  </div>
                  <p className="mt-2 font-medium">{e.text}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {e.type === "TB" ? `signed ${e.signedBy} · answerable ${e.answerableBy}` : `by ${e.author}${e.basis ? ` · basis: ${e.basis}` : ""}`}
                    {e.contests ? ` · contests TB ${shortId(e.contests)}` : ""}
                    {e.supersedes ? ` · promoted from UV ${shortId(e.supersedes)}` : ""}
                    {e.derives.length ? ` · rests on ${e.derives.map(shortId).join(", ")}` : ""}
                    {e.approvals?.length ? ` · ${e.approvals.length} approvals` : ""}
                  </p>
                  {summary && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Approvals: {summary.approvers}
                      {summary.missing.length ? ` · still needs ${summary.missing.join(", ")}` : ""}
                    </p>
                  )}
                  {f.reasons.length > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {f.standing}: {f.reasons.map((r) => `${r.reason} (${shortId(r.premise)}${r.via ? ` via ${shortId(r.via)}` : ""})`).join("; ")}
                    </p>
                  )}
                </div>
                <span className="font-mono text-[10px] text-muted-foreground">#{shortId(e.id)}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {openUv && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="lp-btn shadow-none"
                    onClick={() =>
                      act(`${actor.name} approved “${e.text}”`, (l) =>
                        approve(l, actor, e.id, isPerson ? {} : { evidence: [{ kind: "file", ref: `checked by ${actor.name}` }] })
                      )
                    }
                  >
                    Approve{isPerson ? "" : " with evidence"}
                  </Button>
                )}
                {openUv && isPerson && (
                  <Button size="sm" variant="outline" className="lp-btn shadow-none" onClick={() => act(`Refuted “${e.text}”`, (l) => refute(l, actor, e.id))}>
                    Refute
                  </Button>
                )}
                {e.type === "TB" && ["active", "contested"].includes(f.status) && full && (
                  <Button size="sm" variant="outline" className="lp-btn shadow-none" onClick={() => onContest(e.id)}>
                    Contest
                  </Button>
                )}
                {isPerson && f.status !== "struck" && (
                  <form
                    className="flex items-center gap-1"
                    onSubmit={(ev) => {
                      ev.preventDefault();
                      act(`Struck “${e.text}”`, (l) => strike(l, actor, e.id, opinion[e.id] ?? ""));
                    }}
                  >
                    <Input aria-label={`opinion for ${e.id}`} className="h-8 w-44 text-xs" placeholder="Opinion for the record" value={opinion[e.id] ?? ""} onChange={(ev) => setOpinion({ ...opinion, [e.id]: ev.target.value })} />
                    <Button type="submit" size="sm" variant="destructive" className="lp-btn shadow-none">
                      Strike
                    </Button>
                  </form>
                )}
                {full && (
                  <Button size="sm" variant="ghost" className="lp-btn shadow-none" onClick={() => setOpen(open === e.id ? null : e.id)}>
                    {open === e.id ? "Hide trace" : "Trace"}
                  </Button>
                )}
              </div>
              {t && <Trace node={t} />}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function Trace({ node, depth = 0 }: { node: TraceNode; depth?: number }) {
  return (
    <div className={depth ? "ml-4 border-l border-border pl-3" : "rounded-xl bg-muted p-3"} data-testid="trace">
      <p className="font-mono text-xs">
        {node.type} #{shortId(node.id)} · {statusLabel(node.status)} · {node.standing}
        {node.failing ? <span className="text-destructive"> · failing: {node.failing}</span> : null}
      </p>
      <p className="text-sm">{node.text}</p>
      {node.signedBy && <p className="text-xs text-muted-foreground">answerable: {node.answerableBy}</p>}
      {node.premises.length === 0 && depth === 0 && <p className="mt-1 text-xs text-muted-foreground">Rests on nothing: an axiom of this ledger.</p>}
      {node.premises.map((p) => (
        <Trace key={p.id} node={p} depth={depth + 1} />
      ))}
    </div>
  );
}

// ── review, warnings, events, export ────────────────────────────────────────

function Docket({ ledger }: { ledger: Ledger }) {
  const items = docket(ledger);
  return (
    <Card className="lp-card">
      <CardContent className="pt-6">
        <h3 className="lp-display font-semibold">Your docket</h3>
        <p className="mt-1 text-sm text-muted-foreground">What waits for a person: nominated UVs first, then open UVs, then TBs under appeal.</p>
        {items.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Nothing to review.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2 text-sm" data-testid="docket">
            {items.map((d) => {
              const e = ledger.entries.find((x) => x.id === d.id)!;
              return (
                <li key={d.id} className="rounded-lg border border-border px-3 py-2">
                  <span className="font-mono text-xs text-primary">{d.kind === "appeal" ? "APPEAL" : d.nominated ? "NOMINATED" : "UV"}</span> {e.text}
                  <span className="block text-xs text-muted-foreground">
                    {d.kind === "appeal" ? `${d.contestedBy.length} open appeal${d.contestedBy.length === 1 ? "" : "s"}` : d.missing.length ? `needs ${d.missing.join(", ")}` : "ready"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function WarnOnWrite({ ledger }: { ledger: Ledger }) {
  const [text, setText] = useState("Set LOG_BUDGET to 30 for the demo.");
  const hits = useMemo(() => warnings(ledger, text), [ledger, text]);
  return (
    <Card className="lp-card">
      <CardContent className="pt-6">
        <h3 className="lp-display font-semibold">Warn on write</h3>
        <p className="mt-1 text-sm text-muted-foreground">A TB can retire a value. Anything saved that still uses it is warned, never blocked.</p>
        <Textarea aria-label="draft" className="mt-3 min-h-[80px] font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="mt-2 text-sm" data-testid="warnings">
          {hits.length === 0 ? (
            <p className="text-xs text-muted-foreground">No retired values in this draft.</p>
          ) : (
            hits.map((w) => (
              <p key={`${w.tbId}-${w.dead}`} className="rounded-lg bg-accent/15 px-3 py-2 text-xs">
                ⚠ “{w.dead}”{w.subject ? ` for ${w.subject}` : ""} is retired{w.current ? ` (now ${w.current})` : ""} by TB #{shortId(w.tbId)}: {w.claim}
              </p>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Events({ ledger }: { ledger: Ledger }) {
  const events = [...ledger.events].reverse();
  return (
    <Card className="lp-card">
      <CardContent className="pt-6">
        <h3 className="lp-display font-semibold">Events</h3>
        <p className="mt-1 text-sm text-muted-foreground">Challenged, upheld, overturned, verified, undermined, restored: what a person is told about.</p>
        {events.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">Quiet so far.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-1 text-xs" data-testid="events">
            {events.map((ev, i) => (
              <li key={`${ev.at}-${ev.entry}-${i}`}>
                <span className="font-mono text-primary">{ev.kind}</span> {ev.summary}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function Export({ ledger }: { ledger: Ledger }) {
  const [jsonl, setJsonl] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let live = true;
    chainLines(ledger.lines).then((chained) => {
      if (live) setJsonl(chained.map((l) => JSON.stringify(l)).join("\n"));
    });
    return () => {
      live = false;
    };
  }, [ledger]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(jsonl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Card className="lp-card">
      <CardContent className="pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="lp-display font-semibold">The stream</h3>
            <p className="mt-1 text-sm text-muted-foreground">Every act is a line: append-only, hash-chained (schema 2, JCS + SHA-256). Statuses are a fold over the TRANSITIONs, never an edit.</p>
          </div>
          <Button size="sm" variant="outline" className="lp-btn shadow-none" onClick={copy} disabled={!jsonl}>
            {copied ? "Copied" : "Copy JSONL"}
          </Button>
        </div>
        <pre className="mt-3 max-h-80 overflow-auto rounded-xl bg-muted p-4 font-mono text-[11px] leading-relaxed" data-testid="stream">
          {jsonl || "(no lines yet)"}
        </pre>
      </CardContent>
    </Card>
  );
}
