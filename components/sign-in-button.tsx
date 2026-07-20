"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button, type ButtonProps } from "@/components/ui/button";
import { isVerifierCookieName } from "@/lib/auth-cookies";
import { cookieDomainForHost } from "@/lib/domains";
import { INVITE_COOKIE, normalizeInviteCode } from "@/lib/invites";

function clearStaleVerifierCookies() {
  const names = document.cookie
    .split("; ")
    .map((c) => c.split("=")[0])
    .filter(isVerifierCookieName);
  const domain = cookieDomainForHost(window.location.hostname);
  for (const name of names) {
    document.cookie = `${name}=; path=/; max-age=0`;
    if (domain) document.cookie = `${name}=; path=/; domain=${domain}; max-age=0`;
  }
}

export function GoogleSignInButton({
  label = "Continue with Google",
  next = "/vault",
  intent,
  inviteCode,
  size,
  variant,
  className,
}: {
  label?: string;
  next?: string;
  intent?: "login";
  inviteCode?: string;
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
  className?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    const supabase = createClient();
    if (!supabase) {
      setError("Supabase isn't configured yet — add NEXT_PUBLIC_SUPABASE_URL and the anon key.");
      return;
    }
    setLoading(true);
    clearStaleVerifierCookies();
    if (inviteCode?.trim()) {
      const value = encodeURIComponent(normalizeInviteCode(inviteCode));
      document.cookie = `${INVITE_COOKIE}=${value}; path=/; max-age=600; samesite=lax`;
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}${intent ? `&intent=${intent}` : ""}`,
      },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    }
  }

  return (
    <div className="flex w-full flex-col items-center gap-2">
      <Button onClick={signIn} disabled={loading} size={size} variant={variant} className={className}>
        {loading ? "Opening Google…" : label}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
