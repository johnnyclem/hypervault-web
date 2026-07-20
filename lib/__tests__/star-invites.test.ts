import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SendEmailResult } from "@/lib/email";

const sendEmail = vi.fn<() => Promise<SendEmailResult>>();
vi.mock("@/lib/email", () => ({
  sendEmail: (...a: unknown[]) => sendEmail(...(a as [])),
}));
vi.mock("@/lib/github", () => ({
  fetchStargazers: vi.fn(async () => []),
  fetchUserEmail: vi.fn(async () => null),
  starRepo: () => "acme/widgets",
}));

import { buildInviteEmail, sendWeeklyInvites, type StargazerRow } from "@/lib/star-invites";

type Row = StargazerRow;

function makeAdmin(rows: Row[], mintError: { message: string } | null = null) {
  const mintedCodes: string[] = [];
  const disabledInviteIds: string[] = [];
  const stargazerUpdates: Array<{ id: string; payload: Record<string, unknown> }> = [];
  let seq = 0;

  const client = {
    from(table: string) {
      const state: { op: string; payload: Record<string, unknown> | null; resolved: unknown } = {
        op: "select",
        payload: null,
        resolved: { data: rows, error: null },
      };
      const api: Record<string, unknown> = {};
      api.select = () => api;
      api.insert = (payload: Record<string, unknown>) => {
        state.op = "insert";
        if (table === "invite_codes") mintedCodes.push(String(payload.code));
        return api;
      };
      api.update = (payload: Record<string, unknown>) => {
        state.op = "update";
        state.payload = payload;
        return api;
      };
      api.eq = (_col: string, val: string) => {
        if (state.op === "update") {
          if (table === "invite_codes") disabledInviteIds.push(val);
          else stargazerUpdates.push({ id: val, payload: state.payload ?? {} });
          state.resolved = { data: null, error: null };
        }
        return api;
      };
      api.single = async () => {
        if (mintError) return { data: null, error: mintError };
        seq += 1;
        return { data: { id: `invite-${seq}` }, error: null };
      };
      api.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(state.resolved).then(res, rej);
      return api;
    },
  };

  return { client, mintedCodes, disabledInviteIds, stargazerUpdates };
}

function row(over: Partial<Row>): Row {
  return {
    id: "sg-1",
    github_id: 1,
    github_login: "octocat",
    email: "octo@example.com",
    unsubscribed: false,
    invites_sent: 0,
    ...over,
  };
}

beforeEach(() => {
  sendEmail.mockReset();
  sendEmail.mockResolvedValue({ ok: true, id: "email-1" });
});

describe("buildInviteEmail", () => {
  it("embeds the code and a pre-filled redeem link", () => {
    const { subject, html, text } = buildInviteEmail("HV-ABCD-2345", "octocat");
    expect(subject).toMatch(/invite code/i);
    expect(text).toContain("HV-ABCD-2345");
    expect(text).toContain("/login?invite=HV-ABCD-2345");
    expect(html).toContain("HV-ABCD-2345");
    expect(html).toContain("@octocat");
  });

  it("escapes HTML in the login handle", () => {
    const { html } = buildInviteEmail("HV-ABCD-2345", "<script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("sendWeeklyInvites", () => {
  it("mints and emails a code to every eligible stargazer", async () => {
    const admin = makeAdmin([
      row({ id: "sg-1", github_id: 1, github_login: "alice", email: "a@x.com" }),
      row({ id: "sg-2", github_id: 2, github_login: "bob", email: "b@x.com", invites_sent: 3 }),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const summary = await sendWeeklyInvites(admin.client as any);

    expect(summary).toMatchObject({ eligible: 2, sent: 2, skipped: 0, failures: [] });
    expect(admin.mintedCodes).toHaveLength(2);
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(admin.stargazerUpdates).toHaveLength(2);
    const bob = admin.stargazerUpdates.find((u) => u.id === "sg-2");
    expect(bob?.payload.invites_sent).toBe(4);
    expect(admin.disabledInviteIds).toHaveLength(0);
  });

  it("skips stargazers with no email without minting a code", async () => {
    const admin = makeAdmin([row({ email: null })]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const summary = await sendWeeklyInvites(admin.client as any);
    expect(summary).toMatchObject({ eligible: 0, sent: 0, skipped: 1 });
    expect(admin.mintedCodes).toHaveLength(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("disables the minted code when no email provider is configured", async () => {
    sendEmail.mockResolvedValue({ ok: false, skipped: true });
    const admin = makeAdmin([row({})]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const summary = await sendWeeklyInvites(admin.client as any);
    expect(summary).toMatchObject({ eligible: 1, sent: 0, skipped: 1, failures: [] });
    expect(admin.mintedCodes).toHaveLength(1);
    expect(admin.disabledInviteIds).toHaveLength(1);
    expect(admin.stargazerUpdates).toHaveLength(0);
  });

  it("records a failure and disables the code when delivery errors", async () => {
    sendEmail.mockResolvedValue({ ok: false, error: "Resend 422" });
    const admin = makeAdmin([row({ github_login: "carol" })]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const summary = await sendWeeklyInvites(admin.client as any);
    expect(summary.sent).toBe(0);
    expect(summary.failures).toEqual([{ login: "carol", error: "Resend 422" }]);
    expect(admin.disabledInviteIds).toHaveLength(1);
  });

  it("does not advance the counter when minting fails", async () => {
    const admin = makeAdmin([row({})], { message: "duplicate key" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const summary = await sendWeeklyInvites(admin.client as any);
    expect(summary.sent).toBe(0);
    expect(summary.failures[0]).toMatchObject({ login: "octocat" });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(admin.stargazerUpdates).toHaveLength(0);
  });
});
