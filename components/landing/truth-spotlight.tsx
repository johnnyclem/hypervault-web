import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TruthPlayground } from "@/components/truth-demo/truth-playground";

const POINTS = [
  { title: "Agents assert, people sign", body: "Nothing an agent writes becomes truth on its own. A person's approval, with evidence, promotes it." },
  { title: "Appeals, not deletions", body: "A contested fact stays visible with an asterisk. Strike a premise and everything built on it is undermined." },
  { title: "A record, not a document", body: "Every act is an append-only, hash-chained line. Statuses are folded from the record, never edited into it." },
];

/** The landing page's interactive feature: the truth ledger, playable in place. */
export function TruthSpotlight() {
  return (
    <section id="truth" className="pb-24" data-testid="truth-spotlight">
      <div className="mx-auto max-w-3xl text-center">
        <Badge variant="outline" className="lp-chip mb-4 border-accent/50 text-accent">
          New · Truth Ledger v2
        </Badge>
        <h2 className="lp-display text-3xl font-bold leading-tight sm:text-4xl">A memory your agents can&apos;t quietly rewrite.</h2>
        <p className="mt-4 text-lg text-muted-foreground">
          HyperVault now keeps a truth ledger beside your artifacts: what agents believe, what you have signed,
          and what the model is allowed to cite. Try it right here — the rules run in your browser.
        </p>
      </div>
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {POINTS.map((p) => (
          <div key={p.title} className="lp-card rounded-2xl border border-border bg-card p-5">
            <h3 className="lp-display font-semibold">{p.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{p.body}</p>
          </div>
        ))}
      </div>
      <div className="mt-8">
        <TruthPlayground variant="spotlight" />
      </div>
      <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        <Link href="/truth">
          <Button className="lp-btn">Open the full playground</Button>
        </Link>
        <Link href="/vault/truth/review" className="text-sm font-semibold text-accent underline-offset-4 hover:underline">
          Keep a real ledger in your vault →
        </Link>
      </div>
    </section>
  );
}
