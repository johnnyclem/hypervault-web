
export const MEMORY_CONTENT_BUDGET_BYTES = 400_000;

export class IngestError extends Error {
  status: number;
  constructor(message: string, status = 422) {
    super(message);
    this.status = status;
  }
}

export function clampMemoryContent(text: string, maxBytes = MEMORY_CONTENT_BUDGET_BYTES): string {
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= maxBytes) return text;

  let sliced = text.slice(0, maxBytes);
  while (sliced.length > 0 && encoder.encode(sliced).length > maxBytes) {
    sliced = sliced.slice(0, Math.floor(sliced.length * 0.9));
  }
  return `${sliced.trimEnd()}\n\n[Truncated — the original was larger than the memory size limit.]`;
}
