"use client";

import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-5xl">🔧</p>
      <h1 className="text-2xl font-bold">Minor turbulence</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Something went sideways on our end. Your vault is safe — give it another try.
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
