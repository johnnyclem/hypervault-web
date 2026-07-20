export default function Loading() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-[var(--primary)]" />
      <p className="text-sm text-muted-foreground">Spinning up the flight deck…</p>
    </div>
  );
}
