import { describe, expect, it } from "vitest";
import {
  AGENTS,
  PERSON,
  RuleError,
  approvalSummary,
  approve,
  assertTb,
  assertUv,
  canonical,
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
  type Ledger,
} from "../ledger";

const [claude, codex, gemini] = AGENTS;
const uvOf = (l: Ledger) => [...l.entries].reverse().find((e) => e.type === "UV")!;
const tbOf = (l: Ledger) => [...l.entries].reverse().find((e) => e.type === "TB")!;

describe("assertions", () => {
  it("a person's TB is signed, answerable, active and sound", () => {
    const l = assertTb(emptyLedger(), PERSON, { claim: "The cap is 5.", evidence: [{ kind: "commit", ref: "abc" }] });
    const tb = tbOf(l);
    expect(tb.signedBy).toBe("johnny");
    expect(tb.answerableBy).toBe("johnny");
    expect(fold(l, tb.id)).toMatchObject({ status: "active", standing: "sound", current: true });
    expect(markerFor(tb, fold(l, tb.id))).toBe("[TB]");
    expect(l.lines.map((x) => x.type)).toEqual(["TB"]);
  });

  it("nothing an agent writes is a TB", () => {
    expect(() => assertTb(emptyLedger(), claude, { claim: "x" })).toThrow(RuleError);
  });

  it("an agent's UV is open and unverified", () => {
    const l = assertUv(emptyLedger(), claude, { assertion: "It retries five times." });
    const uv = uvOf(l);
    expect(fold(l, uv.id)).toMatchObject({ status: "open", standing: "sound", current: true });
    expect(markerFor(uv, fold(l, uv.id))).toBe("[UV — UNVERIFIED]");
    expect(contextBlock(l)).toEqual(["[UV — UNVERIFIED] It retries five times. — basis: stated without checking"]);
  });

  it("a contesting UV puts the TB under appeal, and the appeal is listed under it", () => {
    let l = assertTb(emptyLedger(), PERSON, { claim: "The cap is 5." });
    const tb = tbOf(l);
    l = assertUv(l, gemini, { assertion: "The cap is 6.", contests: tb.id });
    expect(fold(l, tb.id).status).toBe("contested");
    expect(l.events.map((e) => e.kind)).toEqual(["challenged"]);
    expect(contextBlock(l)).toEqual(["[TB ⚠ UNDER APPEAL] The cap is 5. (signed: johnny)", "  [UV — UNVERIFIED] The cap is 6."]);
    expect(docket(l).map((d) => d.kind).sort()).toEqual(["appeal", "uv"]);
  });

  it("premises and inference come together", () => {
    const l = assertTb(emptyLedger(), PERSON, { claim: "A" });
    expect(() => assertTb(l, PERSON, { claim: "B", derives: [tbOf(l).id] })).toThrow(/inference/);
    expect(() => assertTb(l, PERSON, { claim: "B", inference: "so" })).toThrow(/derives/);
    expect(() => assertTb(l, PERSON, { claim: "B", derives: ["nope"], inference: "so" })).toThrow(/No entry/);
  });
});

describe("approvals", () => {
  const draft = () => assertUv(emptyLedger(), claude, { assertion: "Billing runs nightly." });

  it("nobody approves what they drafted", () => {
    const l = draft();
    expect(() => approve(l, claude, uvOf(l).id, { evidence: [{ kind: "file", ref: "x" }] })).toThrow(/drafted/);
  });

  it("an agent approval needs settling evidence; one session is one approver", () => {
    const l = draft();
    expect(() => approve(l, codex, uvOf(l).id)).toThrow(/settling evidence/);
    const once = approve(l, codex, uvOf(l).id, { evidence: [{ kind: "file", ref: "cron.yaml" }] });
    expect(once.status).toBe("approved");
    expect(once.missing).toEqual(["a human approval", "a second approver"]);
    expect(() => approve(once.ledger, codex, uvOf(l).id, { evidence: [{ kind: "file", ref: "cron.yaml" }] })).toThrow(/already approved/);
  });

  it("a person alone does not promote; a person plus another with evidence does", () => {
    const l = draft();
    const id = uvOf(l).id;
    const solo = approve(l, PERSON, id);
    expect(solo.status).toBe("approved");
    expect(solo.missing).toEqual(["a second approver", "evidence"]);
    const done = approve(solo.ledger, codex, id, { evidence: [{ kind: "test", ref: "billing.test.ts" }] });
    expect(done.status).toBe("promoted");
    const next = done.ledger;
    expect(fold(next, id).status).toBe("verified");
    const tb = tbOf(next);
    expect(tb).toMatchObject({ text: "Billing runs nightly.", signedBy: "johnny", answerableBy: "johnny", supersedes: id });
    expect(tb.approvals).toHaveLength(2);
    expect(tb.evidence).toEqual([{ kind: "test", ref: "billing.test.ts" }]);
    expect(next.lines.map((x) => x.type)).toEqual(["UV", "ADDENDUM", "TRANSITION", "TB"]);
    expect(next.events.map((e) => e.kind)).toEqual(["verified"]);
    expect(next.approvals[id]).toBeUndefined();
    expect(contextBlock(next)).toEqual(["[TB] Billing runs nightly. (signed: johnny)"]);
  });

  it("a promoted appeal overrides the TB it contested", () => {
    let l = assertTb(emptyLedger(), PERSON, { claim: "The cap is 5." });
    const old = tbOf(l).id;
    l = assertUv(l, gemini, { assertion: "The cap is 6.", contests: old });
    const id = uvOf(l).id;
    l = approve(l, codex, id, { evidence: [{ kind: "commit", ref: "deadbeef" }] }).ledger;
    const out = approve(l, PERSON, id);
    expect(out.status).toBe("promoted");
    expect(fold(out.ledger, old).status).toBe("overridden");
    expect(out.ledger.events.map((e) => e.kind)).toEqual(["challenged", "overturned", "verified"]);
    const addendum = out.ledger.lines.find((x) => x.type === "ADDENDUM") as unknown as { "x-steno": { links: Array<{ type: string }> } };
    expect(addendum["x-steno"].links.map((k) => k.type).sort()).toEqual(["overrides", "verifies"]);
  });

  it("three agent sessions nominate and never settle", () => {
    const l = draft();
    const id = uvOf(l).id;
    const a = approve(l, codex, id, { evidence: [{ kind: "file", ref: "a" }] });
    const b = approve(a.ledger, gemini, id, { evidence: [{ kind: "file", ref: "b" }] });
    expect(b.status).toBe("approved");
    expect(fold(b.ledger, id).corroborated).toBe(false);
    const c = approve(b.ledger, { name: "agent:grok", role: "agent", session: "sess_grok" }, id, { evidence: [{ kind: "file", ref: "c" }] });
    expect(c.status).toBe("nominated");
    expect(c.missing).toEqual(["a human approval"]);
    expect(fold(c.ledger, id)).toMatchObject({ status: "open", corroborated: true });
    expect(markerFor(uvOf(c.ledger), fold(c.ledger, id))).toBe("[UV · CORROBORATED]");
    expect(docket(c.ledger)[0]).toMatchObject({ id, nominated: true });
    const quorum = c.ledger.lines.find((x) => x.type === "ADDENDUM") as unknown as { quorum: unknown[] };
    expect(quorum.quorum).toHaveLength(3);
    expect(approvalSummary(c.ledger, id).agentSessions).toBe(3);
    const promoted = approve(c.ledger, PERSON, id);
    expect(promoted.status).toBe("promoted");
  });

  it("an unsupported UV cannot be promoted", () => {
    let l = assertTb(emptyLedger(), PERSON, { claim: "A" });
    const a = tbOf(l).id;
    l = assertUv(l, claude, { assertion: "B", derives: [a], inference: "because" });
    l = strike(l, PERSON, a, "wrong");
    expect(fold(l, uvOf(l).id).standing).toBe("unsupported");
    expect(() => approve(l, PERSON, uvOf(l).id)).toThrow(/unsupported/);
    expect(docket(l)).toEqual([]);
  });
});

describe("refute and strike", () => {
  it("refuting is a person's act and upholds the contested TB", () => {
    let l = assertTb(emptyLedger(), PERSON, { claim: "The cap is 5." });
    const tb = tbOf(l).id;
    l = assertUv(l, gemini, { assertion: "The cap is 6.", contests: tb });
    const uv = uvOf(l).id;
    expect(() => refute(l, codex, uv)).toThrow(/person's act/);
    expect(() => refute(l, PERSON, uv)).toThrow(/contempt of corpus/);
    // a UV that contests nobody's TB can be refuted by the person
    let m = assertUv(emptyLedger(), claude, { assertion: "Nonsense." });
    m = refute(m, PERSON, uvOf(m).id, { note: "Checked: false." });
    expect(fold(m, uvOf(m).id).status).toBe("refuted");
    expect(m.events.map((e) => e.kind)).toEqual(["overturned"]);
  });

  it("a struck appeal releases its TB; a strike is sticky", () => {
    let l = assertTb(emptyLedger(), PERSON, { claim: "The cap is 5." });
    const tb = tbOf(l).id;
    l = assertUv(l, gemini, { assertion: "The cap is 6.", contests: tb });
    const uv = uvOf(l).id;
    expect(() => strike(l, PERSON, uv, "")).toThrow(/opinion/);
    expect(() => strike(l, gemini, uv, "no")).toThrow(/person's act/);
    l = strike(l, PERSON, uv, "A stale branch.");
    expect(fold(l, uv).status).toBe("struck");
    expect(fold(l, tb).status).toBe("active");
    expect(l.events.map((e) => e.kind)).toEqual(["challenged", "upheld"]);
    expect(l.lines.filter((x) => x.type === "RULING")).toHaveLength(1);
    expect(() => strike(l, PERSON, uv, "again")).toThrow(/Already/);
    expect(() => assertUv(l, gemini, { assertion: "x", contests: uv })).toThrow(/contests a TB/);
  });

  it("a TB stays under appeal while another appeal is open", () => {
    let l = assertTb(emptyLedger(), PERSON, { claim: "The cap is 5." });
    const tb = tbOf(l).id;
    l = assertUv(l, gemini, { assertion: "6", contests: tb });
    const first = uvOf(l).id;
    l = assertUv(l, codex, { assertion: "7", contests: tb });
    l = strike(l, PERSON, first, "no");
    expect(fold(l, tb).status).toBe("contested");
  });
});

describe("standing and trace", () => {
  function tower() {
    let l = assertTb(emptyLedger(), PERSON, { claim: "A" });
    const a = tbOf(l).id;
    l = assertTb(l, PERSON, { claim: "B", derives: [a], inference: "A so B" });
    const b = tbOf(l).id;
    l = assertTb(l, PERSON, { claim: "C", derives: [b], inference: "B so C" });
    return { l, a, b, c: tbOf(l).id };
  }

  it("an appeal below clouds; a strike below kills, through the chain, with via", () => {
    const { l, a, b, c } = tower();
    const appealed = assertUv(l, gemini, { assertion: "not A", contests: a });
    expect(fold(appealed, b)).toMatchObject({ standing: "clouded", current: true });
    expect(fold(appealed, c).reasons).toEqual([{ premise: a, reason: "premise-under-appeal", via: b }]);
    expect(markerFor(appealed.entries.find((e) => e.id === c)!, fold(appealed, c))).toBe("[TB ⚠ CLOUDED]");
    expect(appealed.events.map((e) => e.kind)).toEqual(["challenged", "undermined", "undermined"]);
    const struck = strike(appealed, PERSON, a, "false");
    expect(fold(struck, b)).toMatchObject({ standing: "unsupported", current: false });
    expect(fold(struck, c).standing).toBe("unsupported");
    // the dead TBs leave the block; the appeal, now contesting history, is an open UV on its own
    expect(contextBlock(struck)).toEqual(["[UV — UNVERIFIED] not A — basis: stated without checking"]);
    const t = trace(struck, c)!;
    expect(t.premises[0]).toMatchObject({ id: b, standing: "unsupported" });
    expect(t.premises[0].premises[0]).toMatchObject({ id: a, status: "struck", failing: "premise-struck" });
  });

  it("releasing the appeal restores dependents", () => {
    const { l, a, b } = tower();
    let m = assertUv(l, gemini, { assertion: "not A", contests: a });
    m = strike(m, PERSON, uvOf(m).id, "nonsense");
    expect(fold(m, b).standing).toBe("sound");
    expect(m.events.filter((e) => e.kind === "restored").map((e) => e.entry).sort()).toEqual([b, tbOf(m).id].sort());
  });
});

describe("warn on write", () => {
  const l = assertTb(emptyLedger(), PERSON, { claim: "LOG_BUDGET is 100, not 30.", literals: [{ dead: "30", subject: "LOG_BUDGET", current: "100" }] });

  it("fires on the dead value with its subject, as a whole token", () => {
    expect(warnings(l, "Set LOG_BUDGET to 30 for the demo.")).toMatchObject([{ dead: "30", tbId: tbOf(l).id, line: "Set LOG_BUDGET to 30 for the demo." }]);
    expect(warnings(l, "LOG_BUDGET is 300.")).toEqual([]);
    expect(warnings(l, "Wait 30 seconds.")).toEqual([]);
  });

  it("stays quiet when the replacement is named or the line is history", () => {
    expect(warnings(l, "LOG_BUDGET went from 30 to 100.")).toEqual([]);
    expect(warnings(l, "LOG_BUDGET was 30 last year.")).toEqual([]);
  });

  it("goes quiet when the TB is no longer sound", () => {
    const appealed = assertUv(l, gemini, { assertion: "It's 250.", contests: tbOf(l).id });
    expect(fold(appealed, tbOf(l).id).status).toBe("contested");
    expect(warnings(appealed, "LOG_BUDGET=30")).toEqual([]);
  });
});

describe("the stream", () => {
  it("canonicalises with sorted keys and drops undefined", () => {
    expect(canonical({ b: 1, a: [true, { d: null, c: "x", e: undefined }] })).toBe('{"a":[true,{"c":"x","d":null}],"b":1}');
  });

  it("chains lines: seq, prevHash, and a hash over the line without its hash", async () => {
    const l = story().slice(0, 4).reduce((acc, step) => step.run(acc), emptyLedger());
    const chained = await chainLines(l.lines);
    expect(chained).toHaveLength(l.lines.length);
    expect(chained[0]).toMatchObject({ schemaVersion: 2, seq: 1, prevHash: null });
    for (let i = 1; i < chained.length; i++) expect(chained[i].prevHash).toBe(chained[i - 1].hash);
    const { hash, ...rest } = chained[2];
    expect(await (async () => (await import("../ledger")).sha256Hex(canonical(rest)))()).toBe(hash);
    expect(String(hash)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("the story", () => {
  it("plays through every act", () => {
    const steps = story();
    expect(steps).toHaveLength(9);
    let l = emptyLedger();
    const after: Ledger[] = [];
    for (const s of steps) {
      l = s.run(l);
      after.push(l);
    }
    const retry = after[3].entries.find((e) => e.type === "TB" && e.text.startsWith("The retry cap"))!;
    expect(retry.signedBy).toBe("johnny");
    expect(after[4].events.at(-1)?.kind).toBe("challenged");
    expect(after[5].events.at(-1)?.kind).toBe("upheld");
    const derived = after[6].entries.find((e) => e.text === "A sixth retry never happens.")!;
    expect(derived.derives).toEqual([retry.id]);
    const billing = after[7].entries.find((e) => e.text.startsWith("Billing"))!;
    expect(fold(after[7], billing.id)).toMatchObject({ status: "open", corroborated: true });
    expect(docket(after[7])[0].id).toBe(billing.id);
    expect(fold(after[8], derived.id)).toMatchObject({ standing: "unsupported", current: false });
    expect(after[8].events.at(-1)).toMatchObject({ kind: "undermined", entry: derived.id });
    expect(contextBlock(after[8])).toEqual(["[TB] LOG_BUDGET is 100, not 30. (signed: johnny)", "[UV · CORROBORATED] Billing runs nightly at 02:00 UTC. — basis: cron.yaml"]);
    expect(new Set(l.lines.map((x) => x.id)).size).toBe(l.lines.length);
  });
});
