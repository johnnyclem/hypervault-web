
export type ThinkingSplit = {
  text: string;
  reasoning: string;
};

const TAG = /<(\/?)think(?:ing)?>/gi;

export function stripThinking(raw: string): ThinkingSplit {
  if (!raw || !/<\/?think(?:ing)?>/i.test(raw)) {
    return { text: (raw ?? "").trim(), reasoning: "" };
  }

  const visible: string[] = [];
  const reasoning: string[] = [];
  let cursor = 0;
  let inThought = false;
  TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG.exec(raw))) {
    const chunk = raw.slice(cursor, m.index);
    if (m[1] === "/") {
      reasoning.push(chunk);
      inThought = false;
    } else {
      (inThought ? reasoning : visible).push(chunk);
      inThought = true;
    }
    cursor = m.index + m[0].length;
  }
  const tail = raw.slice(cursor);
  (inThought ? reasoning : visible).push(tail);

  return {
    text: visible.join("").trim(),
    reasoning: reasoning
      .map((r) => r.trim())
      .filter(Boolean)
      .join("\n\n"),
  };
}
