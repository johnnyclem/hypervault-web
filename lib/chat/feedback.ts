import type { SupabaseClient } from "@supabase/supabase-js";


const MAX_RATED_ROWS = 24;
const EXAMPLES_PER_SIDE = 4;
const EXCERPT_CHARS = 280;

export function feedbackExcerpt(content: string): string {
  const flat = content.replace(/\s+/g, " ").trim();
  return flat.length > EXCERPT_CHARS ? `${flat.slice(0, EXCERPT_CHARS - 1)}…` : flat;
}

export function buildFeedbackContext(liked: string[], disliked: string[]): string {
  const up = liked.filter((s) => s.trim()).slice(0, EXAMPLES_PER_SIDE);
  const down = disliked.filter((s) => s.trim()).slice(0, EXAMPLES_PER_SIDE);
  if (up.length === 0 && down.length === 0) return "";

  const lines: string[] = [
    "The user rates assistant replies in this app with thumbs up / thumbs down. Use their recent ratings below as a style guide: match the tone, length, and structure of replies they liked, and avoid what they disliked. Never mention the ratings or these examples.",
  ];
  if (up.length > 0) {
    lines.push("Replies the user liked:");
    for (const s of up) lines.push(`- "${feedbackExcerpt(s)}"`);
  }
  if (down.length > 0) {
    lines.push("Replies the user disliked:");
    for (const s of down) lines.push(`- "${feedbackExcerpt(s)}"`);
  }
  return lines.join("\n");
}

export async function feedbackPreferenceContext(
  db: SupabaseClient,
  userId: string
): Promise<string> {
  const { data, error } = await db
    .from("messages")
    .select("content, feedback")
    .eq("user_id", userId)
    .eq("role", "assistant")
    .not("feedback", "is", null)
    .order("created_at", { ascending: false })
    .limit(MAX_RATED_ROWS);
  if (error || !data) return "";

  const liked: string[] = [];
  const disliked: string[] = [];
  for (const row of data) {
    if (typeof row.content !== "string") continue;
    if (row.feedback === 1) liked.push(row.content);
    else if (row.feedback === -1) disliked.push(row.content);
  }
  return buildFeedbackContext(liked, disliked);
}
