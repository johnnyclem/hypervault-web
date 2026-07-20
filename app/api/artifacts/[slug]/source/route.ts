import { NextResponse, type NextRequest } from "next/server";
import { createClient, getUser } from "@/lib/supabase/server";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to view artifact source." }, { status: 401 });
  }

  const { slug } = await params;
  const supabase = (await createClient())!;
  const { data: artifact, error } = await supabase
    .from("artifacts")
    .select("content")
    .eq("user_id", user.id)
    .eq("slug", slug)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!artifact) return NextResponse.json({ error: "Artifact not found." }, { status: 404 });

  return NextResponse.json({ content: artifact.content });
}
