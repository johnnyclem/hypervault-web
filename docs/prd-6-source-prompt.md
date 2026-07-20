# PRD 6 — Source Prompt + Iterative Building

## Goal

Allow an optional source prompt on save and expose it so LLMs can easily
build on previous artifacts. The prompt that created an artifact travels
*with* the artifact: any agent that opens the link can recover the original
intent and iterate naturally, without the user re-explaining what the page is.

## User story

> I asked Claude for a habit tracker and saved it to my vault. A week later I
> ask a different agent to "add streaks to my habit tracker" and paste the
> link. The agent opens the page, reads the original prompt from the meta
> tag, and regenerates the artifact with streaks — no archaeology required.

## Acceptance criteria

- [x] Optional **"Source prompt"** field on the paste flow (`/vault/new`).
- [x] Saved as `<meta name="hypervault-source-prompt" content="…">` in the
      artifact's HTML `<head>` at save time (created if the document has no
      head), with the content attribute-escaped.
- [x] Also persisted as a `source_prompt` column on `artifacts`
      (migration `0002_source_prompt.sql`) and returned by `GET /api/artifacts`
      so agents can browse prompts without fetching each page.
- [x] MCP tool `save_to_hypervault` accepts a `source_prompt` parameter, and
      the `hypervault://help` resource explains the iterate-on-a-link flow.
- [x] When an agent opens an artifact link, it can read the meta tag and
      include the original prompt in context.
- [x] MCP tool `extract_source_prompt(url)` fetches any artifact URL (vanity
      domains included, over both stdio and HTTP transports) and returns the
      embedded prompt — or a clear message when none exists.
- [x] The paste form pre-fills from a `?source_prompt=` query param so agents
      can deep-link users into the save flow with the prompt attached.

## Constraints & decisions

- **Size limit:** 10,000 characters. Longer prompts are rejected with a clear
  400 — the tag lives in every page load, so it stays lightweight.
- **Injection happens at save time**, after JSX wrapping, so the tag is part
  of the stored content and survives byte-for-byte serving via `/a/[slug]`.
- **Optional everywhere.** Saves without a prompt behave exactly as before;
  the column is nullable and the meta tag is simply absent.
- **Escaping:** the prompt is HTML-attribute-escaped (`& < > "`), so prompts
  containing markup can't break out of the meta tag.

## Definition of done

- [x] Saving with a source prompt works (web form and MCP).
- [x] The meta tag is present in the rendered HTML.
- [x] An agent can use the source prompt to iterate naturally (documented in
      the MCP `hypervault://help` resource).
