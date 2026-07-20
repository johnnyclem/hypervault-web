
export function concatFloat32(chunks: Float32Array[]): Float32Array {
  let length = 0;
  for (const c of chunks) length += c.length;
  const out = new Float32Array(length);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

export function downloadPercent(
  seen: ReadonlyMap<string, { loaded: number; total: number }>,
  expectedBytes: Readonly<Record<string, number>>
): number {
  let loaded = 0;
  let total = 0;
  for (const [label, size] of Object.entries(expectedBytes)) {
    const file = seen.get(label);
    loaded += file?.loaded ?? 0;
    total += file?.total || size;
  }
  for (const [label, file] of seen) {
    if (label in expectedBytes) continue;
    loaded += file.loaded;
    total += file.total;
  }
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.floor((loaded / total) * 100)));
}

export function prepareSpeechText(raw: string): string {
  return raw
    .replace(/```[\s\S]*?(?:```|$)/g, " Code block omitted. ")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/(\*\*|__|\*|_|~~)(\S(?:[^*_~]*\S)?)\1/g, "$2")
    .replace(/^\s*([-*_])\s*(?:\1\s*){2,}$/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
}
