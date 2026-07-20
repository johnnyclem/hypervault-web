"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export type AdminInvite = {
  id: string;
  code: string;
  note: string | null;
  max_uses: number;
  use_count: number;
  disabled: boolean;
  created_at: string;
};

export type AdminWaitlistEntry = {
  user_id: string;
  email: string | null;
  created_at: string;
};

export type AdminAccount = {
  id: string;
  email: string | null;
  displayName: string | null;
  plan: string;
  vanitySubdomain: string | null;
  createdAt: string;
  accessSource: string | null;
};

async function api(path: string, method: string, body?: unknown): Promise<string | null> {
  try {
    const res = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) return null;
    const data = await res.json().catch(() => ({}));
    return data.error ?? `Request failed (${res.status}).`;
  } catch {
    return "Network hiccup — try again.";
  }
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function AdminDashboard({
  invites,
  waitlist,
  accounts,
  adminUserId,
}: {
  invites: AdminInvite[];
  waitlist: AdminWaitlistEntry[];
  accounts: AdminAccount[];
  adminUserId: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [maxUses, setMaxUses] = useState("1");
  const [note, setNote] = useState("");

  async function run(key: string, path: string, method: string, body?: unknown) {
    setBusy(key);
    setError(null);
    const err = await api(path, method, body);
    if (err) setError(err);
    else router.refresh();
    setBusy(null);
  }

  return (
    <div className="flex flex-col gap-8">
      {error && (
        <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Invite codes</CardTitle>
          <CardDescription>
            Each code unlocks sign-up until its uses run out. Share codes anywhere — redemption
            happens at Google sign-in.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              run("create-invite", "/api/admin/invites", "POST", {
                maxUses: Number(maxUses) || 1,
                note: note || undefined,
              });
            }}
          >
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Max uses
              <Input
                type="number"
                min={1}
                max={10000}
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
                className="w-24"
              />
            </label>
            <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-muted-foreground">
              Note (optional)
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Twitter launch batch"
              />
            </label>
            <Button type="submit" disabled={busy === "create-invite"}>
              {busy === "create-invite" ? "Minting…" : "Create code"}
            </Button>
          </form>

          {invites.length === 0 ? (
            <p className="text-sm text-muted-foreground">No invite codes yet — mint your first above.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-4">Code</th>
                    <th className="py-2 pr-4">Uses</th>
                    <th className="py-2 pr-4">Note</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Created</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {invites.map((inv) => {
                    const exhausted = inv.use_count >= inv.max_uses;
                    return (
                      <tr key={inv.id} className="border-t border-border">
                        <td className="py-2 pr-4 font-mono">{inv.code}</td>
                        <td className="py-2 pr-4">
                          {inv.use_count}/{inv.max_uses}
                        </td>
                        <td className="max-w-48 truncate py-2 pr-4 text-muted-foreground">
                          {inv.note ?? "—"}
                        </td>
                        <td className="py-2 pr-4">
                          {inv.disabled ? (
                            <Badge variant="outline">Disabled</Badge>
                          ) : exhausted ? (
                            <Badge variant="secondary">Used up</Badge>
                          ) : (
                            <Badge>Active</Badge>
                          )}
                        </td>
                        <td className="py-2 pr-4 text-muted-foreground">{fmtDate(inv.created_at)}</td>
                        <td className="py-2 text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy === `invite-${inv.id}`}
                              onClick={() =>
                                run(`invite-${inv.id}`, `/api/admin/invites/${inv.id}`, "PATCH", {
                                  disabled: !inv.disabled,
                                })
                              }
                            >
                              {inv.disabled ? "Enable" : "Disable"}
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={busy === `invite-del-${inv.id}`}
                              onClick={() => {
                                if (!window.confirm(`Destroy invite code ${inv.code}?`)) return;
                                run(`invite-del-${inv.id}`, `/api/admin/invites/${inv.id}`, "DELETE");
                              }}
                            >
                              Destroy
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Waitlist</CardTitle>
          <CardDescription>
            People who signed in without an invite, oldest first. Approving unlocks their vault
            immediately.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {waitlist.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nobody is waiting right now.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {waitlist.map((entry) => (
                <li key={entry.user_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-mono text-sm">{entry.email ?? entry.user_id}</p>
                    <p className="text-xs text-muted-foreground">Joined {fmtDate(entry.created_at)}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={busy === `wl-approve-${entry.user_id}`}
                      onClick={() =>
                        run(`wl-approve-${entry.user_id}`, `/api/admin/accounts/${entry.user_id}`, "PATCH", {
                          approved: true,
                        })
                      }
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === `wl-remove-${entry.user_id}`}
                      onClick={() => {
                        if (!window.confirm(`Remove ${entry.email ?? "this user"} from the waitlist?`)) return;
                        run(`wl-remove-${entry.user_id}`, `/api/admin/waitlist/${entry.user_id}`, "DELETE");
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Accounts</CardTitle>
          <CardDescription>
            Every profile, newest first. Deleting an account removes the user and everything they
            saved — there is no undo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No accounts yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-4">Account</th>
                    <th className="py-2 pr-4">Plan</th>
                    <th className="py-2 pr-4">Access</th>
                    <th className="py-2 pr-4">Created</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((acct) => {
                    const isSelf = acct.id === adminUserId;
                    return (
                      <tr key={acct.id} className="border-t border-border">
                        <td className="py-2 pr-4">
                          <p className="font-mono">{acct.email ?? acct.id}</p>
                          <p className="text-xs text-muted-foreground">
                            {acct.displayName ?? "—"}
                            {acct.vanitySubdomain ? ` · ${acct.vanitySubdomain}` : ""}
                            {isSelf ? " · you" : ""}
                          </p>
                        </td>
                        <td className="py-2 pr-4">
                          <Badge variant={acct.plan === "pro" ? "default" : "secondary"}>{acct.plan}</Badge>
                        </td>
                        <td className="py-2 pr-4">
                          {acct.accessSource ? (
                            <Badge variant="outline">{acct.accessSource}</Badge>
                          ) : (
                            <Badge variant="secondary">waitlisted</Badge>
                          )}
                        </td>
                        <td className="py-2 pr-4 text-muted-foreground">{fmtDate(acct.createdAt)}</td>
                        <td className="py-2 text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy === `acct-plan-${acct.id}`}
                              onClick={() =>
                                run(`acct-plan-${acct.id}`, `/api/admin/accounts/${acct.id}`, "PATCH", {
                                  plan: acct.plan === "pro" ? "free" : "pro",
                                })
                              }
                            >
                              {acct.plan === "pro" ? "Downgrade" : "Upgrade"}
                            </Button>
                            {acct.accessSource ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={isSelf || busy === `acct-access-${acct.id}`}
                                onClick={() =>
                                  run(`acct-access-${acct.id}`, `/api/admin/accounts/${acct.id}`, "PATCH", {
                                    approved: false,
                                  })
                                }
                              >
                                Revoke access
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                disabled={busy === `acct-access-${acct.id}`}
                                onClick={() =>
                                  run(`acct-access-${acct.id}`, `/api/admin/accounts/${acct.id}`, "PATCH", {
                                    approved: true,
                                  })
                                }
                              >
                                Approve
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={isSelf || busy === `acct-del-${acct.id}`}
                              onClick={() => {
                                if (
                                  !window.confirm(
                                    `Permanently delete ${acct.email ?? "this account"} and everything they saved?`
                                  )
                                )
                                  return;
                                run(`acct-del-${acct.id}`, `/api/admin/accounts/${acct.id}`, "DELETE");
                              }}
                            >
                              Delete
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
