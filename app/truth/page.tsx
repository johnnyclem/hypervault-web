import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { TruthPlayground } from "@/components/truth-demo/truth-playground";
import { getUser } from "@/lib/supabase/server";

export const metadata = {
  title: "Truth Ledger",
  description:
    "Play the truth ledger in your browser: what agents may write, what only a person may sign, how approvals promote, how appeals cloud, how a struck premise undermines everything resting on it.",
};

const RULES = [
  {
    title: "Nothing an agent writes is a TB",
    body: "An agent's claim lands as a UV — unverified, flagged, never cited as fact. A TB carries a person's signature and a name that answers for it.",
  },
  {
    title: "Promotion needs a person",
    body: "A human approval plus one more approver with settling evidence (a commit, a file, a test) promotes a UV into a TB signed by that person. Two agents never promote.",
  },
  {
    title: "Three agents nominate",
    body: "Three distinct agent sessions approving from their own evidence corroborate a UV: it jumps to the front of your docket, still a UV.",
  },
  {
    title: "Appeals are visible, not fatal",
    body: "A UV that contests a TB puts it under appeal — still truth, with an asterisk, never grounds for a denial. Whatever rests on it is clouded until the appeal settles.",
  },
  {
    title: "Contempt of corpus",
    body: "Nobody approves or refutes what they drafted, and the person who signed a TB cannot refute an appeal against it. They can strike nonsense, with an opinion on the record.",
  },
  {
    title: "A strike kills the tower",
    body: "Strike a premise and every claim pinned to it is unsupported — out of current truth, with the failing premise named in its trace.",
  },
];

export default async function TruthPage() {
  const user = await getUser();

  return (
    <div className="hv-glow min-h-dvh">
      <SiteHeader user={user} />

      <main className="mx-auto w-full max-w-5xl px-6 pb-24">
        <section className="flex flex-col items-center pb-12 pt-10 text-center sm:pt-16">
          <Badge variant="outline" className="mb-6 border-primary/40 text-primary">
            Truth Ledger v2 · interactive
          </Badge>
          <h1 className="max-w-3xl text-4xl font-bold leading-tight sm:text-5xl">A memory your agents can&apos;t quietly rewrite.</h1>
          <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
            Every HyperVault ledger is an append-only, hash-chained stream of claims. Agents assert; people sign.
            Statuses are a fold over the record, standing is derived from the premises a claim rests on, and the
            model is told exactly what it is allowed to cite. This page runs the same rules in your browser, with
            nothing to install and nothing saved.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4 text-sm font-semibold">
            <Link href={user ? "/vault/truth/review" : "/login"} className="text-accent underline-offset-4 hover:underline">
              {user ? "Open my docket →" : "Sign in to keep a real ledger →"}
            </Link>
            <a href="https://github.com/johnnyclem/stenographer" className="text-accent underline-offset-4 hover:underline">
              The codec: stenographer →
            </a>
          </div>
        </section>

        <TruthPlayground />

        <section className="pt-20">
          <h2 className="text-center text-3xl font-bold leading-tight">The rules it plays by</h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-muted-foreground">
            The playground is a faithful model of the rules the <code className="font-mono text-sm">@stenographer/core</code>{" "}
            codec applies and HyperVault&apos;s hosted ledgers enforce. The real thing adds signatures, a database that refuses
            edits, review sessions, and a warn-on-write pass over everything you save.
          </p>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {RULES.map((r) => (
              <Card key={r.title}>
                <CardContent className="pt-6">
                  <h3 className="font-semibold">{r.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{r.body}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
