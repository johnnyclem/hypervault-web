"use client";

import { useState } from "react";
import { GoogleSignInButton } from "@/components/sign-in-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function JoinFlow({
  showInvite = false,
  initialCode = "",
  next,
}: {
  showInvite?: boolean;
  initialCode?: string;
  next?: string;
}) {
  const [inviteOpen, setInviteOpen] = useState(showInvite || Boolean(initialCode));
  const [code, setCode] = useState(initialCode);

  return (
    <div className="flex w-full flex-col items-center gap-4">
      {inviteOpen ? (
        <div className="flex w-full flex-col items-center gap-3">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="HV-XXXX-XXXX"
            autoFocus
            className="text-center font-mono uppercase tracking-widest"
            aria-label="Invite code"
          />
          <GoogleSignInButton
            label="Redeem with Google"
            inviteCode={code}
            next={next}
            size="lg"
            className="w-full"
          />
          <Button variant="ghost" size="sm" onClick={() => setInviteOpen(false)}>
            ← Back
          </Button>
        </div>
      ) : (
        <>
          <GoogleSignInButton label="Login" intent="login" next={next} size="lg" className="w-full" />
          <GoogleSignInButton label="Sign-Up" variant="outline" next={next} size="lg" className="w-full" />
          <Button variant="ghost" size="sm" onClick={() => setInviteOpen(true)}>
            Invite Code?
          </Button>
        </>
      )}
    </div>
  );
}
