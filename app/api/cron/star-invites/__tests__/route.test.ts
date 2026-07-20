import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type Summary = { eligible: number; sent: number; skipped: number; failures: Array<{ login: string; error: string }> };
const syncStargazers = vi.fn(async () => ({ fetched: 3, upserted: 1 }));
const sendWeeklyInvites = vi.fn(
  async (): Promise<Summary> => ({ eligible: 2, sent: 2, skipped: 0, failures: [] })
);
vi.mock("@/lib/star-invites", () => ({
  syncStargazers: (...a: unknown[]) => syncStargazers(...(a as [])),
  sendWeeklyInvites: (...a: unknown[]) => sendWeeklyInvites(...(a as [])),
}));

const createAdminClient = vi.fn(() => ({}) as unknown);
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => createAdminClient() }));

import { GET, POST } from "../route";

const SECRET = "cron-secret";

function request(headers: Record<string, string> = {}, url = "http://localhost/api/cron/star-invites") {
  return new NextRequest(url, { method: "POST", headers });
}

beforeEach(() => {
  syncStargazers.mockClear();
  sendWeeklyInvites.mockClear();
  createAdminClient.mockClear();
  createAdminClient.mockReturnValue({});
  process.env.CRON_SECRET = SECRET;
});
afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("cron /api/cron/star-invites", () => {
  it("503s when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;
    const res = await POST(request({ authorization: `Bearer ${SECRET}` }));
    expect(res.status).toBe(503);
    expect(sendWeeklyInvites).not.toHaveBeenCalled();
  });

  it("401s without the right bearer token", async () => {
    const res = await POST(request({ authorization: "Bearer wrong" }));
    expect(res.status).toBe(401);
    expect(sendWeeklyInvites).not.toHaveBeenCalled();
  });

  it("accepts the secret as a bearer token and runs sync + send", async () => {
    const res = await POST(request({ authorization: `Bearer ${SECRET}` }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, summary: { sent: 2 }, sync: { upserted: 1 } });
    expect(syncStargazers).toHaveBeenCalledTimes(1);
    expect(sendWeeklyInvites).toHaveBeenCalledTimes(1);
  });

  it("accepts the secret via ?secret= on a GET (manual run)", async () => {
    const res = await GET(request({}, `http://localhost/api/cron/star-invites?secret=${SECRET}`));
    expect(res.status).toBe(200);
    expect(sendWeeklyInvites).toHaveBeenCalledTimes(1);
  });

  it("surfaces the migration hint when the invite tables are missing", async () => {
    sendWeeklyInvites.mockResolvedValueOnce({
      eligible: 1,
      sent: 0,
      skipped: 0,
      failures: [
        {
          login: "octocat",
          error: 'Could not find the table "public.invite_codes" in the schema cache',
        },
      ],
    });
    const res = await POST(request({ authorization: `Bearer ${SECRET}` }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("invite tables") });
  });

  it("503s when the service role key is missing", async () => {
    createAdminClient.mockReturnValueOnce(null);
    const res = await POST(request({ authorization: `Bearer ${SECRET}` }));
    expect(res.status).toBe(503);
    expect(sendWeeklyInvites).not.toHaveBeenCalled();
  });
});
