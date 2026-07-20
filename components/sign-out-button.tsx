"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button, type ButtonProps } from "@/components/ui/button";

export function SignOutButton({
  size = "sm",
  variant = "ghost",
}: {
  size?: ButtonProps["size"];
  variant?: ButtonProps["variant"];
}) {
  const [loading, setLoading] = useState(false);

  async function signOut() {
    const supabase = createClient();
    if (!supabase) return;
    setLoading(true);
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  return (
    <Button onClick={signOut} disabled={loading} size={size} variant={variant}>
      {loading ? "Signing out…" : "Sign out"}
    </Button>
  );
}
