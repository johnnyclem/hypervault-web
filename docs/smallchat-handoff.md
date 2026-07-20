# Handoff: `` ```tool `` block parsing truncates on embedded code fences

**For:** the [smallchat](https://github.com/johnnyclem/smallchat) maintainer
**From:** HyperVault (HyperChat), which vendors smallchat's dispatch core and
implements the intent-block chat protocol on top of it.

HyperVault does **not** vendor smallchat's chat-channel / CLI layer — only the
tool-inference core (`core/`, `runtime/`, `compiler/`, see
`lib/vendor/smallchat/VENDORED.md`). The vendored core is **not affected** by
this bug. This handoff is a heads-up that the **same protocol parser almost
certainly lives in upstream smallchat's own channel code** (the part that reads
the model's `` ```tool `` reply and dispatches it), and that code likely carries
the identical flaw. If upstream uses a lazy regex to the closing fence, patch it
there too.

---

## Symptom

A user connected two MCP servers, compiled a toolkit, and asked the assistant to
"create a page about SmallChat." The model correctly emitted a tool call:

````
```tool
{"intent": "create a new page about SmallChat", "args": {"title": "SmallChat",
 "markdown": "# SmallChat\n\n## Integration\n```html\n<script ...></script>\n```\n\nOr in React:\n```jsx\n...\n```\n"}}
```
````

…but it was **rendered to the user as raw text** and **no tool was dispatched**.
The dispatch loop silently treated a valid tool call as an ordinary reply.

## Root cause

The intent block is extracted with a lazy regex that delimits the payload by the
**closing** `` ``` `` fence:

```js
/```tool[ \t]*\r?\n([\s\S]*?)\r?\n?```/
```

The captured payload is JSON, and JSON string values may legitimately contain
`` ``` `` sequences — a page whose `markdown` argument embeds a `` ```html `` or
`` ```jsx `` code fence is the canonical case. The lazy `[\s\S]*?` stops at the
**first** `` ``` `` it sees, which is the one *inside* the JSON string. The
captured text is therefore truncated mid-string into invalid JSON, `JSON.parse`
throws, and the parser's "malformed ⇒ not a tool call, pass through as plain
text" fallback demotes a real dispatch to a plain reply.

Minimal repro (Node):

```js
const RE = /```tool[ \t]*\r?\n([\s\S]*?)\r?\n?```/;
const md = "x\n```html\n<b/>\n```\n";
const reply = "```tool\n" + JSON.stringify({intent:"a", args:{md}}) + "\n```";
JSON.parse(RE.exec(reply)[1]);   // throws: Unterminated string in JSON
```

The failure is **content-dependent**: tool calls whose args contain no `` ``` ``
work fine, which is why it slipped through — it only bites when the model writes
about code or markup (a very common ask).

## Fix (applied in HyperVault)

Do not use the closing fence to delimit the payload. Find the `` ```tool ``
opening fence, then extract the first **balanced** `{…}` object by scanning while
tracking string/escape state, so backticks inside string literals are inert.
Parse that object; ignore any trailing `` ``` ``. See
`extractFencedJson` in `lib/smallchat/intent.ts`.

The reverse direction has the identical hazard: a `` ```tool-result `` block
whose `content` is a fetched page containing code fences fails to rehydrate for
the same reason. Both parsers were switched to the balanced-object scan.

Sketch:

```js
function extractFencedJson(text, fenceRe) {
  const m = fenceRe.exec(text);
  if (!m) return null;
  const open = text.indexOf("{", m.index + m[0].length);
  if (open === -1) return null;
  let depth = 0, inString = false, escaped = false;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return text.slice(open, i + 1);
  }
  return null; // never closed
}
```

## Suggested upstream actions

1. Audit smallchat's own channel/CLI parser for the `` ```tool ``/`` ```tool-result ``
   protocol and replace any lazy-regex fence matching with a balanced-object
   scan (or a real fenced-block tokenizer that ignores fences inside strings).
2. Add regression tests for the two directions above: (a) a tool call whose
   string args embed `` ```html ``/`` ```jsx `` fences; (b) a tool-result whose
   `content` embeds a code fence.
3. Consider documenting in the protocol spec that the payload is delimited by
   JSON balance, not by the first closing fence — so alternative
   implementations don't reintroduce the same bug.
