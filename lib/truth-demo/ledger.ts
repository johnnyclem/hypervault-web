/**
 * The truth ledger, as a playground (hypervault-web's showcase of the
 * Truth Ledger v2 work).
 *
 * A pure, in-memory model of the rules stenographer's codec applies and
 * HyperVault enforces — every line a writer appended, statuses as a fold over
 * TRANSITION lines, standing derived from premises, approvals that promote
 * only with a person, three agents that nominate and never settle, strikes
 * that stick, and the markers a model sees. It exists so a visitor can play
 * the whole story in a browser with nothing to install; the real thing is
 * `@stenographer/core/truth-format` and HyperVault's hosted ledgers, which
 * this mirrors and links to. Nothing here is persisted or signed.
 */

export type Role = "human" | "agent";
export type Actor = { name: string; role: Role; session?: string };

export type Evidence = { kind: string; ref: string; detail?: string };
export type Literal = { dead: string; subject?: string; current?: string };
export type Approval = { by: string; role: Role; ts: string; session?: string; evidence: Evidence[]; note?: string };

export type TbStatus = "active" | "contested" | "overridden" | "struck";
export type UvStatus = "open" | "verified" | "refuted" | "struck";
export type Standing = "sound" | "clouded" | "unsupported";
export type Reason = { premise: string; reason: string; via?: string };

export type Entry = {
  id: string;
  type: "TB" | "UV";
  text: string;
  author: string;
  ts: string;
  evidence: Evidence[];
  /** A TB: who signed and who answers for it. */
  signedBy?: string;
  answerableBy?: string;
  approvals?: Approval[];
  literals?: Literal[];
  /** A UV: why it is believed, and the TB it disputes. */
  basis?: string;
  contests?: string | null;
  /** Pinned premises (derives links) and the inference over them. */
  derives: string[];
  inference?: string;
  /** The UV a promoted TB supersedes. */
  supersedes?: string;
  /** Agent session that wrote the entry, when an agent did. */
  session?: string;
};

/** A line of the stream, as a version 2 writer appends it (the chain is added by `chainLines`). */
export type Line = Record<string, unknown> & { id: string; type: "TB" | "UV" | "ADDENDUM" | "RULING" | "TRANSITION"; ts: string; author: string };

export type EventKind = "challenged" | "upheld" | "overturned" | "verified" | "undermined" | "restored";
export type LedgerEvent = { kind: EventKind; entry: string; summary: string; at: number };

export type Ledger = {
  entries: Entry[];
  lines: Line[];
  /** Standing approvals on open UVs. */
  approvals: Record<string, Approval[]>;
  /** Nominated UVs (an ADDENDUM with a corroborates link that no strike undid). */
  corroborated: string[];
  events: LedgerEvent[];
  clock: number;
};

export type Folded = { status: TbStatus | UvStatus; standing: Standing; reasons: Reason[]; current: boolean; corroborated: boolean };

export class RuleError extends Error {}

// ── identities and ids ──────────────────────────────────────────────────────

export const PERSON: Actor = { name: "johnny", role: "human" };
export const AGENTS: Actor[] = [
  { name: "agent:claude", role: "agent", session: "sess_claude" },
  { name: "agent:codex", role: "agent", session: "sess_codex" },
  { name: "agent:gemini", role: "agent", session: "sess_gemini" },
];

const SETTLING = new Set(["commit", "file", "test", "claimed-command", "wiki"]);
export const isSettling = (e: Evidence) => SETTLING.has(e.kind);

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** A ULID-shaped id from the ledger's clock: sortable, and stable for a given sequence of acts. */
export function demoId(clock: number, tag = ""): string {
  let n = clock;
  let out = "";
  for (let i = 0; i < 10; i++) {
    out = ALPHABET[n % 32] + out;
    n = Math.floor(n / 32);
  }
  return `01DEMO${out}${tag.toUpperCase().padEnd(10, "0")}`.slice(0, 26);
}

const T0 = Date.UTC(2026, 9, 15, 9, 0, 0);
const tsOf = (clock: number) => new Date(T0 + clock * 60_000).toISOString();

export function emptyLedger(): Ledger {
  return { entries: [], lines: [], approvals: {}, corroborated: [], events: [], clock: 0 };
}

// ── the fold ────────────────────────────────────────────────────────────────

function statusOf(ledger: Ledger, id: string): TbStatus | UvStatus | null {
  const entry = ledger.entries.find((e) => e.id === id);
  if (!entry) return null;
  let status: string = entry.type === "TB" ? "active" : "open";
  for (const line of ledger.lines) {
    if (line.type !== "TRANSITION" || line.target !== id) continue;
    if (status === "struck") break;
    status = line.status as string;
  }
  return status as TbStatus | UvStatus;
}

function failure(type: "TB" | "UV", status: string): string | null {
  if (status === "struck") return "premise-struck";
  if (type === "TB") return status === "overridden" ? "premise-overridden" : status === "contested" ? "premise-under-appeal" : null;
  return status === "refuted" ? "premise-refuted" : status === "open" ? "premise-open" : null;
}

/** Standing: the nearest failing premise on each path below the entry (spec, Derivation). */
export function standingOf(ledger: Ledger, id: string, seen = new Set<string>()): { standing: Standing; reasons: Reason[] } {
  const entry = ledger.entries.find((e) => e.id === id);
  if (!entry || seen.has(id)) return { standing: "sound", reasons: [] };
  seen.add(id);
  const reasons: Reason[] = [];
  for (const premiseId of entry.derives) {
    const premise = ledger.entries.find((e) => e.id === premiseId);
    if (!premise) {
      reasons.push({ premise: premiseId, reason: "premise-missing" });
      continue;
    }
    const fail = failure(premise.type, statusOf(ledger, premiseId) ?? "");
    if (fail) {
      reasons.push({ premise: premiseId, reason: fail });
      continue;
    }
    for (const r of standingOf(ledger, premiseId, seen).reasons) reasons.push({ ...r, via: premiseId });
  }
  const dead = reasons.some((r) => ["premise-struck", "premise-overridden", "premise-refuted", "premise-superseded"].includes(r.reason));
  return { standing: dead ? "unsupported" : reasons.length > 0 ? "clouded" : "sound", reasons };
}

export function fold(ledger: Ledger, id: string): Folded {
  const entry = ledger.entries.find((e) => e.id === id)!;
  const status = statusOf(ledger, id)!;
  const { standing, reasons } = standingOf(ledger, id);
  const current = (entry.type === "TB" ? status === "active" || status === "contested" : status === "open") && standing !== "unsupported";
  return { status, standing, reasons, current, corroborated: ledger.corroborated.includes(id) };
}

export const entry = (ledger: Ledger, id: string): Entry | undefined => ledger.entries.find((e) => e.id === id);

// ── the markers a model sees ────────────────────────────────────────────────

export const MARKERS = {
  TB: "[TB]",
  TB_UNDER_APPEAL: "[TB ⚠ UNDER APPEAL]",
  TB_CLOUDED: "[TB ⚠ CLOUDED]",
  UV: "[UV — UNVERIFIED]",
  UV_CORROBORATED: "[UV · CORROBORATED]",
} as const;

export function markerFor(e: Entry, f: Folded): string | null {
  if (!f.current) return null;
  if (e.type === "UV") return f.corroborated ? MARKERS.UV_CORROBORATED : MARKERS.UV;
  if (f.status === "contested") return MARKERS.TB_UNDER_APPEAL;
  return f.standing === "clouded" ? MARKERS.TB_CLOUDED : MARKERS.TB;
}

/** The context block a chat turn would lead with: citable TBs (their appeals indented), then the open UVs. */
export function contextBlock(ledger: Ledger): string[] {
  const out: string[] = [];
  const attached = new Set<string>();
  for (const e of ledger.entries) {
    if (e.type !== "TB") continue;
    const f = fold(ledger, e.id);
    const marker = markerFor(e, f);
    if (!marker) continue;
    const weak = f.standing === "clouded" ? ` — clouded by ${f.reasons.map((r) => r.premise).join(", ")}` : "";
    out.push(`${marker} ${e.text} (signed: ${e.signedBy ?? "?"})${weak}`);
    for (const uv of ledger.entries) {
      if (uv.type !== "UV" || uv.contests !== e.id) continue;
      const uf = fold(ledger, uv.id);
      if (!uf.current) continue;
      attached.add(uv.id);
      out.push(`  ${markerFor(uv, uf)} ${uv.text}`);
    }
  }
  for (const e of ledger.entries) {
    if (e.type !== "UV" || attached.has(e.id)) continue;
    const f = fold(ledger, e.id);
    const marker = markerFor(e, f);
    if (marker) out.push(`${marker} ${e.text}${e.basis ? ` — basis: ${e.basis}` : ""}`);
  }
  return out;
}

// ── writes ──────────────────────────────────────────────────────────────────

type Snapshot = Record<string, { status: string; standing: Standing }>;
const snapshot = (ledger: Ledger): Snapshot => Object.fromEntries(ledger.entries.map((e) => [e.id, { status: statusOf(ledger, e.id)!, standing: standingOf(ledger, e.id).standing }]));
const RANK: Record<Standing, number> = { sound: 0, clouded: 1, unsupported: 2 };

/** Events from before/after: the six kinds HyperVault records. */
function deriveEvents(before: Snapshot, after: Ledger): LedgerEvent[] {
  const events: LedgerEvent[] = [];
  for (const e of after.entries) {
    const was = before[e.id];
    if (!was) continue;
    const now = { status: statusOf(after, e.id)!, standing: standingOf(after, e.id).standing };
    const label = `${e.type} “${e.text}”`;
    if (e.type === "TB") {
      if (was.status !== "contested" && now.status === "contested") events.push({ kind: "challenged", entry: e.id, summary: `${label} was challenged.`, at: after.clock });
      else if (was.status === "contested" && now.status === "active") events.push({ kind: "upheld", entry: e.id, summary: `${label} was upheld.`, at: after.clock });
      else if (was.status !== "overridden" && now.status === "overridden") events.push({ kind: "overturned", entry: e.id, summary: `${label} was overturned.`, at: after.clock });
    } else {
      if (was.status !== "refuted" && now.status === "refuted") events.push({ kind: "overturned", entry: e.id, summary: `${label} was refuted.`, at: after.clock });
      else if (was.status !== "verified" && now.status === "verified") events.push({ kind: "verified", entry: e.id, summary: `${label} was verified.`, at: after.clock });
    }
    if (was.status === now.status && RANK[was.standing] !== RANK[now.standing]) {
      const current = e.type === "TB" ? now.status === "active" || now.status === "contested" : now.status === "open";
      if (current) {
        const worse = RANK[now.standing] > RANK[was.standing];
        events.push({ kind: worse ? "undermined" : "restored", entry: e.id, summary: `${label} was ${worse ? "undermined" : "restored"}: it is now ${now.standing}.`, at: after.clock });
      }
    }
  }
  return events;
}

function commit(before: Snapshot, next: Ledger): Ledger {
  return { ...next, events: [...next.events, ...deriveEvents(before, next)] };
}

function tick(ledger: Ledger): Ledger {
  return { ...ledger, clock: ledger.clock + 1 };
}

const links = (fromId: string, ...rest: Array<{ toId: string; type: string }>) => ({ "x-steno": { origin: "playground", links: rest.map((l) => ({ fromId, ...l })) } });

function transition(ledger: Ledger, target: string, status: string, cause: { kind: string; ref: string }, author: string): Line {
  return { id: `${cause.ref}:${target}`, type: "TRANSITION", ts: tsOf(ledger.clock), author, target, status, cause };
}

function premisesOk(ledger: Ledger, derives: string[], inference: string | undefined) {
  if (derives.length > 0 && !inference?.trim()) throw new RuleError("Premises and inference come together: say what follows from them.");
  if (derives.length === 0 && inference?.trim()) throw new RuleError("An inference names the premises it rests on (derives).");
  for (const id of derives) if (!entry(ledger, id)) throw new RuleError(`No entry ${id} to derive from.`);
}

/** A person asserts a TB directly: signed by and answerable to them. */
export function assertTb(ledger: Ledger, by: Actor, input: { claim: string; evidence?: Evidence[]; literals?: Literal[]; derives?: string[]; inference?: string }): Ledger {
  if (by.role !== "human") throw new RuleError("Nothing an agent writes is a TB. An agent's claim is a UV; a person promotes it in review.");
  if (!input.claim.trim()) throw new RuleError("A TB needs a claim.");
  const evidence = input.evidence?.length ? input.evidence : [{ kind: "file", ref: "notes.md", detail: "stated by the person" }];
  const derives = input.derives ?? [];
  premisesOk(ledger, derives, input.inference);
  const before = snapshot(ledger);
  const next = tick(ledger);
  const id = demoId(next.clock);
  const e: Entry = { id, type: "TB", text: input.claim.trim(), author: by.name, ts: tsOf(next.clock), evidence, signedBy: by.name, answerableBy: by.name, derives, inference: input.inference?.trim() || undefined, literals: input.literals?.filter((l) => l.dead.trim()) };
  const line: Line = {
    id,
    type: "TB",
    ts: e.ts,
    author: by.name,
    claim: e.text,
    evidence,
    signedBy: by.name,
    answerableBy: by.name,
    ...(e.literals?.length ? { literals: e.literals } : {}),
    ...(e.inference ? { inference: e.inference } : {}),
    status: "active",
    ...links(id, ...derives.map((toId) => ({ toId, type: "derives", contentHash: "pinned" }))),
  };
  return commit(before, { ...next, entries: [...next.entries, e], lines: [...next.lines, line] });
}

/** Anyone asserts a UV; one that contests a TB puts it under appeal. */
export function assertUv(ledger: Ledger, by: Actor, input: { assertion: string; basis?: string; contests?: string | null; derives?: string[]; inference?: string }): Ledger {
  if (!input.assertion.trim()) throw new RuleError("A UV needs an assertion.");
  const derives = input.derives ?? [];
  premisesOk(ledger, derives, input.inference);
  let tb: Entry | undefined;
  if (input.contests) {
    tb = entry(ledger, input.contests);
    if (!tb || tb.type !== "TB") throw new RuleError("A UV contests a TB.");
    const s = statusOf(ledger, tb.id);
    if (s !== "active" && s !== "contested") throw new RuleError(`That TB is ${s}: history, not a claim to contest.`);
  }
  const before = snapshot(ledger);
  const next = tick(ledger);
  const id = demoId(next.clock);
  const e: Entry = { id, type: "UV", text: input.assertion.trim(), author: by.name, ts: tsOf(next.clock), evidence: [], basis: input.basis?.trim() || "stated without checking", contests: tb?.id ?? null, derives, inference: input.inference?.trim() || undefined, session: by.session };
  const line: Line = {
    id,
    type: "UV",
    ts: e.ts,
    author: by.name,
    assertion: e.text,
    basis: e.basis,
    verifyBy: { kind: "inspect", value: "the source" },
    contests: e.contests,
    ...(e.inference ? { inference: e.inference } : {}),
    status: "open",
    ...links(id, ...(tb ? [{ toId: tb.id, type: "contests" }] : []), ...derives.map((toId) => ({ toId, type: "derives", contentHash: "pinned" }))),
  };
  const lines = [...next.lines, line];
  if (tb && statusOf(ledger, tb.id) === "active") lines.push(transition(next, tb.id, "contested", { kind: "contest", ref: id }, by.name));
  return commit(before, { ...next, entries: [...next.entries, e], lines });
}

export type ApproveOutcome = { ledger: Ledger; status: "approved" | "nominated" | "promoted"; missing: string[] };

/** Where a UV stands on its way to a TB. */
export function approvalSummary(ledger: Ledger, uvId: string): { approvers: number; human: boolean; agentSessions: number; missing: string[] } {
  const rows = ledger.approvals[uvId] ?? [];
  const keys = new Set(rows.map((a) => (a.role === "agent" ? `session:${a.session}` : `human:${a.by}`)));
  const human = rows.some((a) => a.role === "human");
  const evidence = rows.some((a) => a.evidence.length > 0);
  const missing: string[] = [];
  if (!human) missing.push("a human approval");
  if (keys.size < 2) missing.push("a second approver");
  if (!evidence) missing.push("evidence");
  return { approvers: keys.size, human, agentSessions: rows.filter((a) => a.role === "agent").length, missing };
}

/**
 * Approve a UV. A person plus one more approver with evidence promotes it:
 * an ADDENDUM verifies it (and overrides the TB it contests), the TB is
 * signed by the person, who answers for it. Three agent sessions nominate
 * it: corroborated, first on the docket, still a UV.
 */
export function approve(ledger: Ledger, by: Actor, uvId: string, input: { evidence?: Evidence[]; note?: string } = {}): ApproveOutcome {
  const uv = entry(ledger, uvId);
  if (!uv || uv.type !== "UV") throw new RuleError("Approvals promote UVs.");
  const f = fold(ledger, uvId);
  if (f.status !== "open") throw new RuleError(`This UV is already ${f.status}.`);
  if (f.standing === "unsupported") throw new RuleError("This UV is unsupported: a premise below it is dead. It can't be promoted.");
  if (uv.author === by.name || (by.session && uv.session === by.session)) throw new RuleError(`${by.name} drafted this UV and cannot approve it: nobody approves what they drafted.`);
  const evidence = input.evidence ?? [];
  if (by.role === "agent" && !evidence.some(isSettling)) throw new RuleError("An agent's approval cites settling evidence of its own (a commit, file or test): its confidence is not evidence.");
  const rows = ledger.approvals[uvId] ?? [];
  const key = by.role === "agent" ? `session:${by.session}` : `human:${by.name}`;
  if (rows.some((a) => (a.role === "agent" ? `session:${a.session}` : `human:${a.by}`) === key)) throw new RuleError(`${by.name} already approved this UV: one session is one approver.`);

  const before = snapshot(ledger);
  let next = tick(ledger);
  const approval: Approval = { by: by.name, role: by.role, ts: tsOf(next.clock), session: by.session, evidence, note: input.note?.trim() || undefined };
  const all = [...rows, approval];
  next = { ...next, approvals: { ...next.approvals, [uvId]: all } };
  const summary = approvalSummary(next, uvId);

  if (summary.missing.length === 0) {
    const human = [...all].reverse().find((a) => a.role === "human")!;
    const union: Evidence[] = [];
    for (const a of all) for (const e of a.evidence) if (!union.some((u) => u.kind === e.kind && u.ref === e.ref)) union.push(e);
    const addendumId = demoId(next.clock, "AD");
    const tbId = demoId(next.clock, "TB");
    const contested = uv.contests ? entry(next, uv.contests) : undefined;
    const overrides = contested && ["active", "contested"].includes(statusOf(next, contested.id) ?? "") ? contested.id : null;
    const lines: Line[] = [
      ...next.lines,
      { id: addendumId, type: "ADDENDUM", ts: approval.ts, author: human.by, evidence: union, note: human.note ?? `Approved by ${human.by} with ${all.length - 1} other approval${all.length === 2 ? "" : "s"}.`, ...links(addendumId, { toId: uvId, type: "verifies" }, ...(overrides ? [{ toId: overrides, type: "overrides" }] : [])) },
      transition(next, uvId, "verified", { kind: "verify", ref: addendumId }, human.by),
      ...(overrides ? [transition(next, overrides, "overridden", { kind: "override", ref: addendumId }, human.by)] : []),
    ];
    const tb: Entry = { id: tbId, type: "TB", text: uv.text, author: human.by, ts: approval.ts, evidence: union, signedBy: human.by, answerableBy: human.by, approvals: all, derives: uv.derives, inference: uv.inference, supersedes: uvId, literals: undefined };
    lines.push({
      id: tbId,
      type: "TB",
      ts: approval.ts,
      author: human.by,
      claim: uv.text,
      evidence: union,
      signedBy: human.by,
      answerableBy: human.by,
      approvals: all.map((a) => ({ by: a.by, role: a.role, ts: a.ts, ...(a.session ? { agentSessionId: a.session } : {}) })),
      ...(uv.inference ? { inference: uv.inference } : {}),
      status: "active",
      ...links(tbId, { toId: uvId, type: "supersedes" }, ...uv.derives.map((toId) => ({ toId, type: "derives", contentHash: "pinned" }))),
    });
    const { [uvId]: _consumed, ...rest } = next.approvals;
    void _consumed;
    return { ledger: commit(before, { ...next, entries: [...next.entries, tb], lines, approvals: rest }), status: "promoted", missing: [] };
  }

  if (by.role === "agent" && !next.corroborated.includes(uvId)) {
    const agents = all.filter((a) => a.role === "agent");
    const sessions = new Set(agents.map((a) => a.session));
    if (sessions.size >= 3) {
      const addendumId = demoId(next.clock, "NM");
      const evidenceAll = agents.flatMap((a) => a.evidence);
      const line: Line = { id: addendumId, type: "ADDENDUM", ts: approval.ts, author: by.name, evidence: evidenceAll, note: `Nominated by ${sessions.size} agent sessions for a person's review.`, quorum: agents.map((a) => ({ author: a.by, agentSessionId: a.session, ts: a.ts, evidence: a.evidence, verdict: "verified" })), ...links(addendumId, { toId: uvId, type: "corroborates" }) };
      return { ledger: commit(before, { ...next, lines: [...next.lines, line], corroborated: [...next.corroborated, uvId] }), status: "nominated", missing: summary.missing };
    }
  }
  return { ledger: commit(before, next), status: "approved", missing: summary.missing };
}

/** Refute a UV: the person's act, with evidence. A TB it contested is upheld when nothing else contests it. */
export function refute(ledger: Ledger, by: Actor, uvId: string, input: { evidence?: Evidence[]; note?: string } = {}): Ledger {
  if (by.role !== "human") throw new RuleError("Refuting is a person's act: agents assert and approve, a person decides.");
  const uv = entry(ledger, uvId);
  if (!uv || uv.type !== "UV") throw new RuleError("Refutations resolve UVs.");
  if (fold(ledger, uvId).status !== "open") throw new RuleError("This UV is already resolved.");
  if (uv.author === by.name) throw new RuleError("Nobody refutes what they drafted.");
  if (uv.contests) {
    const tb = entry(ledger, uv.contests);
    if (tb && (tb.signedBy === by.name || tb.author === by.name)) {
      throw new RuleError(`${by.name} stands behind the TB this appeal contests and cannot refute it (contempt of corpus). Approve the appeal to overturn the TB, strike it if it is nonsense, or leave it.`);
    }
  }
  const before = snapshot(ledger);
  const next = tick(ledger);
  const addendumId = demoId(next.clock, "RF");
  const evidence = input.evidence?.length ? input.evidence : [{ kind: "file", ref: "the source", detail: "checked by the person" }];
  const lines: Line[] = [
    ...next.lines,
    { id: addendumId, type: "ADDENDUM", ts: tsOf(next.clock), author: by.name, evidence, note: input.note?.trim() || null, ...links(addendumId, { toId: uvId, type: "refutes" }) },
    transition(next, uvId, "refuted", { kind: "refute", ref: addendumId }, by.name),
  ];
  const after = { ...next, lines };
  const release = releaseContest(after, uv, { kind: "refute", ref: addendumId }, by.name);
  const { [uvId]: _dropped, ...rest } = after.approvals;
  void _dropped;
  return commit(before, { ...after, lines: release ? [...lines, release] : lines, approvals: rest });
}

function releaseContest(ledger: Ledger, uv: Entry, cause: { kind: string; ref: string }, author: string): Line | null {
  if (!uv.contests) return null;
  if (statusOf(ledger, uv.contests) !== "contested") return null;
  const other = ledger.entries.some((e) => e.type === "UV" && e.id !== uv.id && e.contests === uv.contests && statusOf(ledger, e.id) === "open");
  if (other) return null;
  return transition(ledger, uv.contests, "active", cause, author);
}

/** Strike an entry: the person's ruling. Sticky; a struck appeal releases its TB. */
export function strike(ledger: Ledger, by: Actor, id: string, opinion: string): Ledger {
  if (by.role !== "human") throw new RuleError("A ruling is a person's act.");
  const e = entry(ledger, id);
  if (!e) throw new RuleError("No such entry.");
  if (!opinion.trim()) throw new RuleError("A ruling carries an opinion: say why.");
  if (statusOf(ledger, id) === "struck") throw new RuleError("Already struck.");
  const before = snapshot(ledger);
  const next = tick(ledger);
  const rulingId = demoId(next.clock, "RL");
  const lines: Line[] = [
    ...next.lines,
    { id: rulingId, type: "RULING", ts: tsOf(next.clock), author: by.name, kind: "strike", opinion: opinion.trim(), target: id, answerableBy: by.name, ...links(rulingId, { toId: id, type: "strikes" }) },
    transition(next, id, "struck", { kind: "strike", ref: rulingId }, by.name),
  ];
  const after = { ...next, lines, corroborated: next.corroborated.filter((c) => c !== id) };
  const release = e.type === "UV" && statusOf(ledger, id) === "open" ? releaseContest(after, e, { kind: "strike", ref: rulingId }, by.name) : null;
  const { [id]: _dropped, ...rest } = after.approvals;
  void _dropped;
  return commit(before, { ...after, lines: release ? [...lines, release] : lines, approvals: rest });
}

// ── the docket and the trace ────────────────────────────────────────────────

export type DocketItem = { kind: "uv" | "appeal"; id: string; nominated: boolean; contestedBy: string[]; missing: string[] };

export function docket(ledger: Ledger): DocketItem[] {
  const items: DocketItem[] = [];
  for (const e of ledger.entries) {
    const f = fold(ledger, e.id);
    if (e.type === "UV" && f.status === "open" && f.standing !== "unsupported") items.push({ kind: "uv", id: e.id, nominated: f.corroborated, contestedBy: [], missing: approvalSummary(ledger, e.id).missing });
    if (e.type === "TB" && f.status === "contested") {
      items.push({ kind: "appeal", id: e.id, nominated: false, contestedBy: ledger.entries.filter((u) => u.type === "UV" && u.contests === e.id && fold(ledger, u.id).status === "open").map((u) => u.id), missing: [] });
    }
  }
  return items.sort((a, b) => (a.nominated === b.nominated ? 0 : a.nominated ? -1 : 1));
}

export type TraceNode = { id: string; type: "TB" | "UV"; text: string; status: string; standing: Standing; signedBy?: string; answerableBy?: string; failing?: string; premises: TraceNode[] };

export function trace(ledger: Ledger, id: string, depth = 6): TraceNode | null {
  const e = entry(ledger, id);
  if (!e) return null;
  const f = fold(ledger, id);
  const direct = new Map(f.reasons.map((r) => [r.via ?? r.premise, r.reason]));
  return {
    id,
    type: e.type,
    text: e.text,
    status: f.status,
    standing: f.standing,
    signedBy: e.signedBy,
    answerableBy: e.answerableBy,
    premises: depth === 0 ? [] : e.derives.map((p) => {
      const child = trace(ledger, p, depth - 1);
      const failing = direct.get(p);
      return child ? { ...child, ...(failing ? { failing } : {}) } : { id: p, type: "TB" as const, text: "(not held)", status: "unknown", standing: "sound" as const, premises: [] };
    }),
  };
}

export function dependents(ledger: Ledger, id: string): Entry[] {
  return ledger.entries.filter((e) => e.derives.includes(id));
}

// ── warn on write ───────────────────────────────────────────────────────────

export type Warning = { tbId: string; dead: string; subject?: string; current?: string; claim: string; line: string };

const NEGATION = /\b(not|never|no longer|don't|do not|was|were|removed|dropped|retired|instead of)\b/i;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A model of the codec's literal matcher (precision over recall): the dead
 * value as a whole token, its subject on the same line when it has one, the
 * replacement not named on that line, and no negation or past tense cue.
 */
export function warnings(ledger: Ledger, text: string): Warning[] {
  const out: Warning[] = [];
  const lines = text.split("\n");
  for (const e of ledger.entries) {
    if (e.type !== "TB" || !e.literals?.length) continue;
    const f = fold(ledger, e.id);
    if (f.status !== "active" || f.standing !== "sound") continue;
    for (const literal of e.literals) {
      const token = new RegExp(`(^|[^A-Za-z0-9_.])${esc(literal.dead)}(?![A-Za-z0-9_.])`);
      const hit = lines.find((line) => {
        if (!token.test(line)) return false;
        if (literal.subject && !line.toLowerCase().includes(literal.subject.toLowerCase()) && !line.toLowerCase().includes(literal.subject.toLowerCase().replace(/_/g, " "))) return false;
        if (literal.current && line.includes(literal.current)) return false;
        return !NEGATION.test(line);
      });
      if (hit && !out.some((w) => w.tbId === e.id && w.dead === literal.dead)) out.push({ tbId: e.id, dead: literal.dead, subject: literal.subject, current: literal.current, claim: e.text, line: hit.trim() });
    }
  }
  return out;
}

// ── the stream, hash-chained ────────────────────────────────────────────────

/** JCS for the plain values this model writes: keys sorted at every level, no whitespace. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The lines as a version 2 stream: schemaVersion, seq, prevHash and the hash of the line without `hash`. */
export async function chainLines(lines: Line[]): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  let prevHash: string | null = null;
  for (const [i, line] of lines.entries()) {
    const unhashed = { schemaVersion: 2, seq: i + 1, ...line, prevHash };
    const hash = await sha256Hex(canonical(unhashed));
    out.push({ ...unhashed, hash });
    prevHash = hash;
  }
  return out;
}

// ── the story ───────────────────────────────────────────────────────────────

export type StoryStep = { title: string; what: string; run: (l: Ledger) => Ledger };

/** The guided tour: every rule in eight acts. */
export function story(): StoryStep[] {
  const claude = AGENTS[0];
  const codex = AGENTS[1];
  const gemini = AGENTS[2];
  const find = (l: Ledger, text: string) => l.entries.find((e) => e.text === text)!;
  const findTb = (l: Ledger, text: string) => l.entries.find((e) => e.type === "TB" && e.text === text)!;
  const last = (l: Ledger, type: "TB" | "UV") => [...l.entries].reverse().find((e) => e.type === type)!;
  return [
    { title: "You assert a TB", what: "A fact you stand behind: signed by you, answerable to you, with evidence. It retires the value 30.", run: (l) => assertTb(l, PERSON, { claim: "LOG_BUDGET is 100, not 30.", evidence: [{ kind: "commit", ref: "c0ffee1" }], literals: [{ dead: "30", subject: "LOG_BUDGET", current: "100" }] }) },
    { title: "An agent asserts a UV", what: "An agent's claim is never a TB. It lands as a UV: believed, flagged, unproven.", run: (l) => assertUv(l, claude, { assertion: "The retry cap is read once, at start-up.", basis: "config.ts loads it before the loop" }) },
    { title: "A second agent approves", what: "With settling evidence of its own. Two agents never promote: the UV waits for you.", run: (l) => approve(l, codex, last(l, "UV").id, { evidence: [{ kind: "file", ref: "src/config.ts:12" }] }).ledger },
    { title: "You approve: promoted", what: "Your approval plus one other with evidence promotes the UV into a TB signed by you. Answerability is assigned here and nowhere else.", run: (l) => approve(l, PERSON, find(l, "The retry cap is read once, at start-up.").id).ledger },
    { title: "An agent appeals your TB", what: "A UV that contests a TB puts it under appeal: still truth, with a visible asterisk, never grounds for a denial.", run: (l) => assertUv(l, gemini, { assertion: "LOG_BUDGET was bumped to 250 last week.", basis: "a stale branch", contests: find(l, "LOG_BUDGET is 100, not 30.").id }) },
    { title: "You strike the appeal", what: "You can't refute an appeal against your own TB (contempt of corpus), but you can strike nonsense with an opinion on the record. The TB is upheld.", run: (l) => strike(l, PERSON, find(l, "LOG_BUDGET was bumped to 250 last week.").id, "No such bump: the branch never merged.") },
    { title: "A derived TB", what: "A claim that rests on another, pinned as a premise with the inference stated. Standing is derived from what it rests on.", run: (l) => assertTb(l, PERSON, { claim: "A sixth retry never happens.", evidence: [{ kind: "test", ref: "retry.test.ts" }], derives: [findTb(l, "The retry cap is read once, at start-up.").id], inference: "The loop stops at the cap." }) },
    { title: "Three agents nominate", what: "A third session approving from a different angle nominates the UV: corroborated, first on the docket, still a UV until you approve it.", run: (l) => {
      let next = assertUv(l, claude, { assertion: "Billing runs nightly at 02:00 UTC.", basis: "cron.yaml" });
      const id = last(next, "UV").id;
      next = approve(next, codex, id, { evidence: [{ kind: "file", ref: "cron.yaml:3" }] }).ledger;
      next = approve(next, gemini, id, { evidence: [{ kind: "commit", ref: "b1111ng" }] }).ledger;
      return approve(next, { name: "agent:grok", role: "agent", session: "sess_grok" }, id, { evidence: [{ kind: "test", ref: "billing.test.ts" }] }).ledger;
    } },
    { title: "A premise dies: dependents undermined", what: "Strike the premise and everything resting on it is undermined — out of current truth, with the failing premise named in the trace.", run: (l) => strike(l, PERSON, findTb(l, "The retry cap is read once, at start-up.").id, "The cap is read on every attempt; the claim was wrong.") },
  ];
}
