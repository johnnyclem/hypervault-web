import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { appUrl } from "@/lib/utils";
import { resolveArtifactIcon } from "./resolve";

export const dynamic = "force-dynamic";

const DEFAULT_SIZE = 512;
const MIN_SIZE = 48;
const MAX_SIZE = 512;

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const raw = Number(new URL(req.url).searchParams.get("size"));
  const size = Number.isFinite(raw) ? Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(raw))) : DEFAULT_SIZE;

  const resolved = await resolveArtifactIcon(slug);

  if (!resolved) return Response.redirect(`${appUrl()}/icons/icon-512.png`, 307);

  const [from, to] = resolved.gradient;
  const glyphChars = Array.from(resolved.glyph).length;
  const fontScale = glyphChars >= 2 ? 0.42 : 0.58;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: `linear-gradient(135deg, ${from}, ${to})`,
          color: "white",
          fontSize: Math.round(size * fontScale),
          fontWeight: 700,
          fontFamily: "sans-serif",
          letterSpacing: -2,
        }}
      >
        {resolved.glyph}
      </div>
    ),
    {
      width: size,
      height: size,
      headers: {
        "Cache-Control": resolved.isPrivate
          ? "private, no-store"
          : "public, max-age=3600, s-maxage=86400",
      },
    }
  );
}
