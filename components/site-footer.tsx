import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-border py-10">
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-3 px-6 text-sm text-muted-foreground sm:flex-row sm:justify-between">
        <p>HyperVault — permastorage for your AI artifacts.</p>
        <nav className="flex gap-5">
          <Link href="/upgrade" className="hover:text-foreground">
            Pricing
          </Link>
          <Link href="/cool" className="hover:text-foreground">
            vault.cool
          </Link>
          <a href="https://github.com/johnnyclem/hypervault-web" className="hover:text-foreground">
            GitHub
          </a>
        </nav>
      </div>
    </footer>
  );
}
