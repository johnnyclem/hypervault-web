"use client";

import type { ServerRow } from "@/components/tools/types";

export type OAuthConnectResult =
  | { ok: true; server: ServerRow; message: string }
  | { ok: false; error: string; oauthUnavailable?: boolean }
  | { ok: false; error: string; cancelled: true };

type StartTarget = { url: string; name?: string; registryId?: string | null; serverId?: string };

export async function connectWithOAuth(target: StartTarget): Promise<OAuthConnectResult> {
  let authorizationUrl: string;
  try {
    const res = await fetch("/api/mcp-servers/oauth/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: target.url,
        name: target.name,
        registry_id: target.registryId ?? undefined,
        server_id: target.serverId,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: data.error ?? "Could not start the login.", oauthUnavailable: data.oauth_available === false };
    }
    authorizationUrl = data.authorization_url as string;
  } catch {
    return { ok: false, error: "Network hiccup starting the login — try again." };
  }

  const popup = window.open(authorizationUrl, "mcp-oauth", "width=520,height=680,menubar=no,toolbar=no");
  if (!popup) {
    return { ok: false, error: "Your browser blocked the login popup — allow popups and retry." };
  }

  return new Promise<OAuthConnectResult>((resolve) => {
    let settled = false;
    const finish = (result: OAuthConnectResult) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      clearInterval(poll);
      resolve(result);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as Record<string, unknown> | null;
      if (!data || data.type !== "mcp-oauth") return;
      if (data.ok === true && data.server) {
        finish({ ok: true, server: data.server as ServerRow, message: (data.message as string) ?? "Connected." });
      } else {
        finish({ ok: false, error: (data.error as string) ?? "Authorization failed." });
      }
    };
    window.addEventListener("message", onMessage);

    const poll = setInterval(() => {
      if (popup.closed) finish({ ok: false, error: "Authorization was cancelled.", cancelled: true });
    }, 500);
  });
}
