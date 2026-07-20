import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { stripThinking } from "@/lib/chat/thinking";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";


type PageParams = { params: Promise<{ slug: string }> };

async function loadSharedConversation(slug: string) {
  const admin = createAdminClient();
  if (!admin) return null;

  const { data: conversation } = await admin
    .from("conversations")
    .select("id, title, model, visibility, updated_at")
    .eq("share_slug", slug)
    .in("visibility", ["shared", "public"])
    .maybeSingle();
  if (!conversation) return null;

  const { data: messages } = await admin
    .from("messages")
    .select("id, role, content, model, position")
    .eq("conversation_id", conversation.id)
    .in("role", ["user", "assistant"])
    .order("position", { ascending: true });

  const cleaned = (messages ?? []).map((m) => {
    if (m.role !== "assistant") return m;
    const { text, reasoning } = stripThinking(m.content);
    return { ...m, content: text || reasoning };
  });
  return { conversation, messages: cleaned };
}

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { slug } = await params;
  const data = await loadSharedConversation(slug);
  return { title: data ? data.conversation.title : "Not found" };
}

export default async function SharedConversationPage({ params }: PageParams) {
  const { slug } = await params;
  const data = await loadSharedConversation(slug);
  if (!data) notFound();
  const { conversation, messages } = data;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-4 px-4 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{conversation.title}</h1>
        <p className="text-xs text-muted-foreground">
          A {conversation.visibility === "public" ? "public" : "shared"} conversation from{" "}
          <Link href="/" className="text-accent underline underline-offset-4">
            HyperVault
          </Link>
          {conversation.model ? ` · ${conversation.model}` : ""}
        </p>
      </header>
      <section className="flex flex-col gap-4">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground">This conversation has no messages yet.</p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-4 py-3 text-sm ${
              m.role === "user"
                ? "self-end bg-primary text-primary-foreground"
                : "self-start border bg-muted/50"
            }`}
          >
            {m.content}
            {m.role === "assistant" && m.model && (
              <div className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                {m.model}
              </div>
            )}
          </div>
        ))}
      </section>
    </main>
  );
}
