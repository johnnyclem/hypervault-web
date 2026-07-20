# M12 — Import AI History

**Status:** Draft · **Epic:** M12 · **Depends:** M2 (authed identity); surfaces in M8 (imported convos appear in the chat list)

## Goal

Let a user pull their entire history out of any LLM and into their vault in
canonical form. The web flow uploads a platform export (`conversations.json`
etc.) and falls back to a pasted transcript; on the phone the file path uses
`expo-document-picker` + reading the file as text, and paste is a first-class
peer. One `POST /api/import {data, platform?}` (`maxDuration 60`, ≤ 50 MB) does
the reconstruction and returns imported/skipped/messages counts. Import dedupes
by external id, so re-importing the same export is safe. Imported conversations
show up in the M8 chat list and can be continued on any backend.

## User stories

- As a user, I can pick a platform (or auto-detect) and import my ChatGPT,
  Claude, Gemini, or Grok export.
- As a user, I can pick the export file from my device or paste a raw
  transcript when I don't have a file.
- As a user, I see clear instructions for where to get each platform's export.
- As a user, after import I see how many conversations were imported vs.
  skipped and how many messages came in, and I find those threads in Chat.
- As a user, re-importing the same export doesn't create duplicates.

## Tasks

| ID | Title | Pts | Depends | Description / Acceptance |
| --- | --- | --- | --- | --- |
| T-M12-01 | Import screen scaffold | 1 | T-M1-08, T-M2 | Import screen (reachable from Vault and Settings). Title/intro mirroring web copy, a link to continue threads in Chat (M8). Loading/error states per index conventions. Acceptance: screen renders authed; unauthed users are held by the auth gate. |
| T-M12-02 | Platform selector | 1 | T-M12-01 | Segmented control / picker with Auto-detect (default), ChatGPT (OpenAI export), Claude (Anthropic export), Gemini (Google Takeout), Grok (X archive). Selection maps to the `platform` field (`""`→omit for auto). Acceptance: choosing a platform sets the value sent to `/api/import`; Auto-detect omits `platform`. |
| T-M12-03 | File pick + read (expo-document-picker) | 2 | T-M12-02 | Pick a `.json`/`.txt`/`.md` file via `expo-document-picker`, read its contents to a string (`expo-file-system` / document-picker asset). Show the loaded filename + "ready to import". Enforce the `import_bytes` cap (50 MB) client-side from capabilities before sending; oversize shows a clear message, no request. Reading replaces any pasted text. Acceptance: picking a valid export loads its text and shows the filename; a > 50 MB file is rejected before upload; picking is cancellable. |
| T-M12-04 | Paste transcript fallback | 1 | T-M12-02 | Multi-line text input for a pasted transcript (speaker labels are enough), disabled while a file is loaded (file wins, mirroring web). Acceptance: with no file, pasted text is importable; loading a file disables/overrides the paste box. |
| T-M12-05 | Submit import + result | 2 | T-M12-03, T-M12-04 | `POST /api/import {data, platform?}`. `data` = file text or pasted text. Determinate busy state ("Reconstructing your threads…") given `maxDuration 60`. On success show `imported / skipped / messages` counts + `message`; clear inputs. Errors (400/413/500) shown verbatim; network failure reassures the export is safe locally. Acceptance: a real export imports and shows the three counts; a 413 (too large / server cap) surfaces the error; the form resets after success. |
| T-M12-06 | "Where to get your export" instructions | 1 | T-M12-01 | Instruction card per platform: ChatGPT (Settings → Data controls → Export → `conversations.json`), Claude (Settings → Privacy → Export → `conversations.json`), Gemini (Google Takeout → Gemini Apps → `MyActivity.json`), Grok (X → Settings → Download an archive), and "anything else → paste". Acceptance: each platform's path is shown; copy matches the web page. |
| T-M12-07 | Idempotency + link into chat list | 1 | T-M12-05, T-M8 | Document and rely on server-side dedupe by external id — re-importing the same export is safe and increments `skipped`, not `imported`. After import, invalidate the conversations cache so imported threads appear in the M8 chat list (`GET /api/conversations`, carrying `source_platform`). Acceptance: importing the same file twice adds nothing the second time; imported conversations appear in Chat tagged with their source platform. |

## Out of scope / notes

- No multipart here — `/api/import` takes JSON `{data,…}`, unlike memory import
  (`/api/memories/import`, M6) which is multipart. Read the file to a string and
  send it in the body.
- The 50 MB cap is `capabilities.limits.import_bytes`; enforce client-side
  before the request (index conventions) to avoid uploading a doomed payload.
- Imported transcripts are untrusted content (spec §10) — they render through
  the same message components as chat and are never treated as markup/code.
- **Zip archives (web):** full platform data exports (Grok/X's "download an
  archive" in particular) ship as a zip bundling the conversation JSON next to
  the account/billing JSON and hundreds of MB of image attachments — the file
  picker used to reject `.zip` outright, making the feature dead-on-arrival for
  that export shape. The web form (`components/import-form.tsx`) now accepts
  `.zip`, unzips it in the browser with `fflate` (`lib/imports/zip.ts`), scans
  the JSON entries for the one that actually holds conversations (auth/billing
  JSON files parse fine but score zero), and sends only that JSON on through
  the existing `/api/import` path — image bytes inside the zip are never
  inflated, only counted. Attachment binaries themselves aren't re-hosted yet;
  that's follow-up work once we've seen a real conversation-file shape with
  attachment references. The mobile `expo-document-picker` flow (T-M12-03)
  doesn't have zip support yet — same gap applies there.
