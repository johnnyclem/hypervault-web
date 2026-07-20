import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-5xl">🛰️</p>
      <h1 className="text-2xl font-bold">Lost in space</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        This page doesn&apos;t exist. Your artifacts, however, are safe and sound.
      </p>
      <Link href="/">
        <Button variant="secondary">Back to HyperVault</Button>
      </Link>
    </div>
  );
}
