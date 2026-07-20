# HyperVault API Contract — Mobile Reference

The exact request/response shape of every endpoint the mobile app uses.
Verified against the route handlers in `app/api/` and `app/a`, `app/auth`,
`app/manifest`. This is the source of truth for the HyperVault SDK (M1).

## Auth models

- **`resolveApiIdentity`** (most routes) accepts, in order:
  `X-HyperVault-Key: hv_…` (60/min/key) · **`Authorization: Bearer <supabase
  jwt>`** (120/min/user) · Supabase SSR cookie (web). Non-admin session/bearer
  callers without an `account_access` row → **403** (waitlisted).
- **session/bearer-only** (no API key): `/api/keys`, `/api/artifacts/[slug]/source`,
  `/api/invite/redeem`, all `/api/admin/*`. *(Bearer support on `/api/keys` and
  `/api/invite/redeem` is a follow-up — see M2 T-M2-09.)*
- **public:** `GET /api/claim-domain`, `/a/[slug]`, `/api/manifest/[slug]`,
  `/manifest.webmanifest`, `/auth/callback`, **`GET /api/capabilities`**.

**Shared errors** on `resolveApiIdentity` routes: `401` (no/invalid credential),
`403` (waitlisted), `429` (rate limit), `503` (`{error}` — server not
configured / migration behind), `400 {error:"Body must be JSON."}` on malformed
JSON. Body is always `{ error: string }`. Send `Content-Type: application/json`.

---

## NEW — mobile endpoints (shipped with this handoff)

### `GET /api/capabilities` — bootstrap descriptor · public
Enriched with a `user` block when a credential is present.
```jsonc
{
  "app_url": "https://hypervault.store",
  "api_version": "2026-07-15",
  "auth": { "supabase_url": "…|null", "supabase_anon_key": "…|null",
            "bearer_header": "Authorization", "api_key_header": "X-HyperVault-Key",
            "invite_gated": true },
  "features": { "configured": true, "deep_memory": false, "key_encryption": true,
                "smart_context": true, "on_device_inference": true },
  "limits": { "artifact_bytes": 1000000, "source_prompt_chars": 10000,
              "chat_message_chars": 100000, "memory_bytes": 500000,
              "import_bytes": 50000000, "max_backends": 20, "max_mcp_servers": 20,
              "max_pro_subdomains": 10, "rate_limit_per_min": {"api_key":60,"user":120} },
  "providers": [ /* provider registry, same as GET /api/backends.providers */ ],
  "domains":   [ { "domain":"vault.cool", "tagline":"…", "featured":true, "available":true }, … ],
  "themes":    [ { "id":"modern-dark", "name":"Modern Dark", "mode":"dark" }, … ],
  "user":      { "id":"…", "email":"…|null", "via":"bearer" }   // only when authed
}
```

### `POST /api/chat/context` — assemble on-device chat context · resolveApiIdentity · read-only
Body: `{ message (req, ≤100k), conversation_id?, use_recall?=true, use_smart_context?, use_deep_memory? }`
200: `{ conversation_id|null, system, messages:[CanonicalMessage], next_position, recalled:[{title,slug}], recalled_memories:[title], smart_context:bool, deep_memory:labels|null }`.
Errors: 400 (no message), 413, 404 (conversation not found), 503.

### `POST /api/chat/turns` — persist an on-device turn · resolveApiIdentity · single writer
Body: `{ user_message (req), assistant_content (req), conversation_id?, title?, model? }`
200: `{ conversation_id, reply:{ id, role:"assistant", content, model } }`. Creates the conversation when `conversation_id` is omitted.
Errors: 400 (missing user_message/assistant_content), 413, 404, 500, 503.

---

## Vault — artifacts

- **`POST /api/save`** — persist artifact (JSX auto-wrap, dedupe by content hash).
  Body: `content`(req,≤1MB), `title`, `type`, `tags[≤20]`, `connect_to[≤20]`,
  `make_pwa`=true, `force_html`=false, `visibility`("public"|"private")="private",
  `source_prompt`(≤10k). → `{url,slug,is_jsx,is_pwa,visibility,connections:{manual,auto},message}`
  or dupe `{…,duplicate:true}`. 400/413/500.
- **`GET /api/artifacts`** — list (≤200, newest). → `{items:[{slug,title,type,tags,source_prompt,is_pwa,is_jsx,visibility,created_at,url}]}`.
- **`PATCH /api/artifacts`** — `{id|slug, visibility}` → `{artifact,message}`. 400/404/503/500.
- **`DELETE /api/artifacts`** — `{id|slug}` → `{deleted,message}`. 400/404/500.
- **`GET /api/artifacts/[slug]/source`** — *session/bearer only.* → `{content}`. 401/404.
- **`GET /api/artifacts/[slug]/feedback`** → `{feedback:"up"|"down"|null}`.
- **`POST /api/artifacts/[slug]/feedback`** — `{feedback:"up"|"down"|null}` → `{slug,feedback,message}`. 503(0017).

## Connections
- **`GET /api/connections`** → `{connections:[{id,a_id,b_id,kind,created_at}], memory_links:[…], memory_artifact_links:[{id,memory_id,artifact_id,kind,created_at}]}`.
- **`POST /api/connections`** — `{source,target}` (id/slug/title of artifact or id/title of memory) → `{connected:[fromId,toId],message}`. 400/404.
- **`DELETE /api/connections`** — `{id}` → `{deleted:id}`.

## Sharing
- **`GET /api/shares?artifact={id|slug}`** → `{shares:[{id,email,display_name,created_at}]}`. owner-only. 400/404/503.
- **`POST /api/shares`** — `{artifact,email}` → `{shared_with:{email,display_name},message}`. 400/404/503.
- **`DELETE /api/shares`** — `{share_id}` → `{message}`.

## Memory wiki
- **`GET /api/memories?q=&branch=`** — browse (no q) or recall (q).
  Browse → `{branch,memories:[{id,title,summary,tags,source,created_at}]}`.
  Recall → `{query,branch,recall_mode:"lexical"|"hybrid",results:[{id,title,summary,tags,source,created_at,score,content?,related:[title],provenance}],message}`.
- **`POST /api/memories`** — `content`(req,≤500k), `title?`, `tags?`, `source?`, `branch?`, `message?` → `{id,title,summary,tags,source,links,branch,commit_id,message}`. 413.
- **`GET /api/memories/[id]?branch=`** → `{branch,memory:{id,title,content,summary,tags,source,created_at},related:[…],artifacts:[…],provenance,revision_count}`.
- **`PATCH /api/memories/[id]`** — `{title?,content?,tags?,branch?,message?}` → `{id,title,summary,tags,branch,commit_id,links,message}`. 400(nothing changed)/413.
- **`DELETE /api/memories/[id]?branch=`** → `{deleted:id,branch,message}`.
- **`GET /api/memories/[id]/history?limit=&full=1`** → `{memory_id,revisions:[{revision_id,op,title,summary,tags,source,content?,commit:{id,message,author_kind,author_key_prefix?,branch,created_at}|null}]}`.
- **`POST /api/memories/import?branch=`** — multipart `file` (PDF/DOCX/md/txt) OR JSON `{url}` (GitHub repo / web page). 12/min. → same shape as POST /api/memories. 400/413/415/429/503(0006).

## Git-for-a-Mind
- **`GET /api/mind/commits?branch=&limit=`** → `{branch,commits:[{id,message,author_kind,author_key_prefix?,parent_commit_id,merge_parent_commit_id,created_at,change_counts:{created,updated,deleted,links}}]}`.
- **`GET /api/mind/branches`** → `{branches:[{id,name,is_default,head_commit_id,created_at,memory_count}]}`.
- **`POST /api/mind/branches`** — `{name,from?="main"}` → `{id,name,from,head_commit_id,message}`. 400/409/404.
- **`DELETE /api/mind/branches/[name]`** → `{deleted,message}`. 400(default)/404/409(in use).
- **`GET /api/mind/state?at=&branch=`** — `at`=commit/branch/timestamp → `{at,commit_id,memories:[{id,title,summary,tags,source,committed_at}],links,message}`. 400.
- **`POST /api/mind/merge`** — `{source,target?="main",message?,resolutions?:[{memory_id,resolution:"ours"|"theirs"|{title,content,tags?}}]}` → `{commit_id,merged:{created,updated,deleted},links_changed,message}`. **409** conflict → `{error,conflicts:[{memory_id,base,ours,theirs,hunks_ours,hunks_theirs}]}`.
- **`GET /api/mind/diff?from=&to=&memory_id=&branch=`** — single-memory or full graph diff. See spec; returns hunks (`add`/`del`/`ctx` lines).
- **`POST /api/mind/revert`** — `{memory_id,revision_id,branch?}` → `{commit_id,restored:{memory_id,title,revision_id},branch,message}`.

## Chat
- **`POST /api/chat`** — server backend turn. `maxDuration 120`, non-streaming.
  Body: `backend_id`(req), `message`(req,≤100k), `conversation_id?`, `use_recall?`=true,
  `use_smart_context?`, `use_deep_memory?`, `use_tools?`.
  → `{conversation_id, reply:{id,role,content,model,truncated}, backend:{id,name,provider}, recalled:[{title,slug}], recalled_memories:[title], smart_context:bool, deep_memory:labels|null, tools:{status:"ok"|"off"|"stale",toolkit_id,turns:[{intent,tool,ok,confidence?,tier?,preview}]}}`.
  400/413/404/502/500.
- **`GET /api/conversations`** → `{conversations:[{id,title,source_platform,model,created_at,updated_at,visibility?,share_slug?}]}` (≤500).
- **`POST /api/conversations`** — `{title?}` → `{conversation:{…}}`.
- **`GET /api/conversations/[id]`** → `{conversation:{…}, messages:[{id,role,content,attachments,model,position,created_at,feedback?}]}`.
- **`PATCH /api/conversations/[id]`** — `{visibility:"private"|"shared"|"public"}` → `{conversation:{…},share_url:string|null,message}`. 503(0016).
- **`DELETE /api/conversations/[id]`** → `{message}`.
- **`POST /api/messages/[id]/feedback`** — `{feedback:"up"|"down"|null}` → `{id,feedback,message}`. 400(non-assistant)/503(0014).
- **`GET /api/chat-settings`** → `{smart_context:bool,deep_memory:bool}`.
- **`PATCH /api/chat-settings`** — `{smart_context?,deep_memory?}` (≥1) → `{smart_context,deep_memory}`.

## Backends
- **`GET /api/backends`** → `{backends:[{id,name,provider,base_url,default_model,embedding_model,key_hint,created_at,last_used_at}], providers:[…specs]}`.
- **`POST /api/backends`** — `{provider(req),name?,api_key?,base_url?,default_model?,embedding_model?,skip_test?}` → `{backend,message}`. `maxDuration 60` (live connection test). Max 20. 400/503/500.
- **`PATCH /api/backends`** — `{id(req),name?,api_key?,base_url?,default_model?,embedding_model?,skip_test?}` → `{backend,message}`. Provider fixed; blank key kept.
- **`DELETE /api/backends`** — `{id}` → `{message}`.

## MCP & tools
- **`GET /api/mcp-servers`** → `{servers:[publicServer]}`.
- **`POST /api/mcp-servers`** — `{url(req,http/https),name?,headers?,registry_id?}` → `{server,message}`. `maxDuration 60` (live introspection). Max 20. 400/409/502.
- **`PATCH /api/mcp-servers/[id]`** — `{name?,enabled?,disabled_tools?[≤500],headers?}` → `{server}`.
- **`DELETE /api/mcp-servers/[id]`** → `{ok:true,message}`.
- **`POST /api/mcp-servers/[id]/refresh`** → `{tools:[…],disabled_tools:[…],introspected_at}`. 502.
- **`GET /api/toolkits`** → `{toolkit:{id,stats,embedder,embedder_label,compiled_at}|null, stale:bool}`.
- **`POST /api/toolkits/compile`** — `{servers?:[{id,enabled?,disabled_tools?}]}` → compile outcome. `maxDuration 300`. 422(CompileError)/502(all unreachable).
- **`GET /api/registry/search?q=`** → `{servers:[…],suggested:[…]}`.

## Domains & themes
- **`GET /api/claim-domain?name=&base=`** — *public,* 30/min/IP → `{available:true}` | `{available:false,reason}`.
- **`POST /api/claim-domain`** — `{desired_name,base_domain?="vault.cool"}` → `{domain,url,claimed,max_subdomains,message}`. 400/403(max)/409(taken).
- **`PATCH /api/claim-domain`** — `{subdomain,base_domain?,theme}` → `{domain,theme,message}`. 503.
- **`PATCH /api/dashboard-theme`** — `{theme:styleId|null}` → `{theme,message}`. 400(unknown)/503.

## Keys · Import · Invites · Admin
- **`POST /api/keys`** — *session/bearer.* 5/min → `{key,prefix,message}` (raw shown once).
- **`DELETE /api/keys`** — `{id}` → `{revoked:id}`.
- **`POST /api/import`** — `{data(req,≤50MB),platform?,title?}` → `{platform,imported,skipped,messages,message}`. `maxDuration 60`.
- **`POST /api/invite/redeem`** — *session/bearer,* 10/min → `{result:"ok"|"already_approved"}` | 400 `{result}`.
- **`PATCH /api/admin/accounts/[id]`** — `{plan?,displayName?,approved?}`. *admin.*
- **`DELETE /api/admin/accounts/[id]`** — delete auth user. *admin.*
- **`POST /api/admin/invites`** — `{maxUses?,note?}` → `{invite}`. *admin.* (no GET list.)
- **`PATCH /api/admin/invites/[id]`** — `{disabled}`. **`DELETE`** destroy. *admin.*
- **`DELETE /api/admin/waitlist/[id]`** — drop from waitlist. *admin.*

## Direct Supabase (bypass the REST API where it's simplest)
The app also holds a Supabase session, so a few reads are cheaper direct
(RLS-scoped to the user): `account_access` (invite-gate check),
`rpc('redeem_invite_code', {p_code})`. Prefer the REST API for everything with
business logic; use direct Supabase only for these auth-gate primitives.

## Canonical types
```ts
type CanonicalRole = "system" | "user" | "assistant" | "tool";
interface CanonicalAttachment { name: string; mime_type?: string; size?: number; extracted_text?: string; }
interface CanonicalMessage { role: CanonicalRole; content: string; attachments: CanonicalAttachment[]; model?: string; createdAt?: string; }
```
```
