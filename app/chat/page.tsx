import { redirect } from "next/navigation";
import { ChatSurface, type BackendRow, type ConversationRow } from "@/components/chat/chat-surface";
import { SiteHeader } from "@/components/site-header";
import { getAccess } from "@/lib/access";
import { isMissingEmbeddingColumn } from "@/lib/backends/schema-compat";
import { getDashboardTheme } from "@/lib/dashboard-theme";
import { loadChatContextSettings } from "@/lib/chat/settings";
import { isStenographerConfigured } from "@/lib/stenographer/client";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata = { title: "Chat" };
export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const { user, approved } = await getAccess();
  if (!user) redirect("/login");
  if (!approved) redirect("/waitlist");

  const supabase = (await createClient())!;
  const [conversationsRes, backendsRes, dashboardTheme, contextSettings, toolkitRes] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, title, source_platform, model, updated_at, visibility, share_slug")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(500),
    supabase
      .from("llm_backends")
      .select("id, name, provider, base_url, default_model, embedding_model, key_hint")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    getDashboardTheme(user.id),
    loadChatContextSettings(supabase, user.id),
    supabase.from("toolkits").select("id").eq("user_id", user.id).eq("is_active", true).maybeSingle(),
  ]);

  let conversations = conversationsRes.data;
  if (conversationsRes.error && /visibility|share_slug/i.test(conversationsRes.error.message)) {
    const retry = await supabase
      .from("conversations")
      .select("id, title, source_platform, model, updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(500);
    conversations = retry.data?.map((c) => ({ ...c, visibility: "private", share_slug: null })) ?? null;
  }

  let backends = backendsRes.data;
  if (backendsRes.error && isMissingEmbeddingColumn(backendsRes.error)) {
    const retry = await supabase
      .from("llm_backends")
      .select("id, name, provider, base_url, default_model, key_hint")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    backends = retry.data?.map((b) => ({ ...b, embedding_model: null })) ?? null;
  }

  return (
    <div className={cn("flex min-h-dvh flex-col", dashboardTheme.wrapperClass)}>
      <SiteHeader user={user} />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pb-6 md:px-6 md:pb-10">
        <ChatSurface
          initialConversations={(conversations ?? []) as ConversationRow[]}
          initialBackends={(backends ?? []) as BackendRow[]}
          initialContextSettings={contextSettings}
          stenographerConfigured={isStenographerConfigured()}
          initialHasToolkit={Boolean(toolkitRes.data)}
        />
      </main>
    </div>
  );
}
