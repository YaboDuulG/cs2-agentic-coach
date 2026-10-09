# In-app assistant: one tool surface, one chat per user

Plan of record, written 2026-10-09 against `main` = `05ff374`. Answers "can we
set up an internal MCP server for DemoSage and open a 1:1 chat window per
user?" Yes; this is how.

## 1. The idea in one paragraph

Define DemoSage's data and actions once, as a list of **tools** (list my
matches, get this match's findings, show round 14, list the team's strats,
create a draft strat, run an ingest). Expose that list two ways: as an **MCP
server** on the API for outside assistants (Claude Desktop, Cursor), and
**in-process** for a chat window inside the app. The in-app chat is a
backend loop: the model reads the user's question, calls the tools it needs
(scoped to that user), and answers. The window is per user, remembers its
history, and is gated and metered like everything else.

## 2. What already exists

| Piece | State | Reuse |
|---|---|---|
| Team "Coach" chat (`POST /api/teams/{id}/strategies/chat`, `CoachTab.tsx`) | RAG over the team's ingested strategies + one Gemini text call; no tools, no memory, history sent from the browser | Becomes one tool (`search_team_strategies`) and is replaced by the assistant |
| Match Q&A (`api/routes/chat.py`) | Runs the Great Khan graph per question with a `match_id`; the supervisor routes to tactical / general / server | The tactical path becomes a tool (`ask_match_coach`); the supervisor's keyword routing goes away because the model picks tools itself |
| Evidence pack, pro comps, baselines (`agents/scribe/evidence.py`) | Built per report | `get_match_evidence` tool so answers cite the same facts the report did |
| Warlord allowlist (`services/warlord/rcon_client.py`) | Enforced | `run_server_command` tool reuses it unchanged |
| Auth `Principal`, entitlements, metering | Done | Every tool call runs as the signed-in user; Team tools 402 without the season; each model call metered `purpose="assistant"` |
| `mcp>=1.0.0` | Already in `requirements.txt` (not in `requirements-ci.txt`, not installed) | The SDK the server is built on |

Nothing is persisted for chats today; that is new.

## 3. Architecture

```
frontend  AssistantPanel (per user, streamed)      Claude Desktop / Cursor
   │ POST /api/assistant/messages (SSE)                 │ MCP over HTTP
   ▼                                                    ▼
Next proxy ──▶ FastAPI  /api/assistant/*        FastAPI /mcp  (FastMCP mount)
                      │                                 │
                      └────── services/assistant/tools.py ──────┘
                               one registry: name, schema, handler(principal, args)
                                        │
                      Gemini function calling (in-app)   |   MCP tool calls (external)
                                        │
                     matches · findings · telemetry · strats · pro library · servers
```

- **`services/assistant/tools.py`**: plain functions with pydantic argument
  models. One decorator registers each for both the MCP server and the
  in-app loop. Handlers take the `Principal` and do their own entitlement
  check, so a tool can never see data its caller cannot.
- **`services/assistant/loop.py`**: the in-app agent loop. Loads the
  conversation, sends system prompt + history + tool schemas to Gemini with
  function calling, executes tool calls in-process (no network hop), appends
  results, repeats until the model answers or a cap of 8 tool calls per turn,
  streams tokens as SSE. Gemini stays the model (per the earlier decision); a
  `coaching_model`-style config key allows a swap later.
- **`services/assistant/mcp_server.py`**: FastMCP app exposing the same
  registry, mounted at `/mcp` with the streamable HTTP transport. Auth by
  personal access token (below). Read-only tools first.
- **Persistence**: `assistant_conversations (id, user_id, team_id?, title,
  created_at, updated_at)` and `assistant_messages (id, conversation_id, role,
  content_json, tool_calls_json, tokens_in, tokens_out, created_at)`. One
  active conversation per user by default, with a list to start another.
- **Personal access tokens** (for MCP only): `user_api_tokens (id, user_id,
  token_hash, label, last_used_at, revoked_at)`, minted and revoked on
  Settings → Account; shown once. The API's `get_current_user` accepts
  `Bearer <token>` by hash lookup and resolves to that user's `Principal`.

### Tool list, first cut

| Tool | Scope | Writes |
|---|---|---|
| `list_my_matches(scope)` | user, teams | no |
| `get_match_summary(match_id)` | member | no |
| `get_match_findings(match_id)` | member; redacted shape by tier | no |
| `get_round(match_id, round)` | member | no |
| `get_match_evidence(match_id)` | member | no |
| `ask_match_coach(match_id, question)` | member; runs the Khan tactical path | no |
| `list_team_strats(team_id, map?)` | member | no |
| `get_strat(strat_id)` | member | no |
| `search_team_strategies(team_id, query)` | member (today's Coach chat) | no |
| `list_pro_strats(map, side?)` | Team plan; after pro-strats P2 | no |
| `create_draft_strat(team_id, …)` | Team plan | yes |
| `request_discord_ingest(team_id, channel)` | Team plan | yes (queues) |
| `run_server_command(server_id, command)` | member; allowlist | yes |

Write tools confirm in the chat UI before executing (the loop returns a
"needs confirmation" event; the panel shows a button).

### Frontend

`components/assistant/AssistantPanel.tsx`: a slide-over opened from the
navbar (and a full page at `/assistant`), message list, streamed answer,
tool-call rows rendered as compact chips ("Read round 14 of Anubis"),
confirmation buttons for write tools, a conversation switcher. Context
seeding: opened from a debrief, the first message carries that `match_id`;
from a Team Hub, the `team_id`. `useAssistant` hook over SSE; TanStack Query
for conversations. Visible to signed-in users; Free users get the read tools
on their own matches (findings in the redacted shape), the rest shows the
upgrade modal.

## 4. Phases

| # | Scope | Size |
|---|---|---|
| A1 | Tool registry + the eight read tools + tests that every tool refuses foreign data | 1 session |
| A2 | Conversation tables, the loop with Gemini function calling, SSE route, metering, caps | 1–2 sessions |
| A3 | AssistantPanel, navbar entry, context seeding from debrief and Team Hub, screenshots at 1440/390 in three themes | 1–2 sessions |
| A4 | Write tools with confirmation (draft strat, ingest, allowlisted server command); the Coach tab stays | 1 session |
| A5 | MCP server at `/mcp` + personal tokens on Settings; verify with Claude Desktop; list in the MCP directories. After pro-strats P4 | 1 session |

A1–A4 give the in-app chat; A5 is the external port and follows the pro library.

## 5. Guardrails

- Per-user isolation is in the tool handlers, not the prompt. A test suite
  calls every tool as user B against user A's data and expects 403/404.
- Caps: 8 tool calls per turn, 30 turns per conversation before a summary
  compacts it, a per-user daily token budget tied to tier (Free small, Solo
  Pro moderate, Team large) checked in the loop; over budget returns a clear
  message, not a 500.
- Citations: answers about a match must quote round numbers from tool
  results; the system prompt carries the same evidence contract the report
  uses, and the loop rejects a final answer that names a round the tools did
  not return (same regex check as the pro-strat writer).
- Write tools never run on the model's say-so alone; the confirmation event
  is the rule, including for `run_server_command`.
- Metering: every Gemini call records `purpose="assistant"` with the user
  and team, so the admin page shows assistant spend next to coaching spend.

## 6. Decisions (taken 2026-10-09)

- **E1. Who gets it**: paid only. Solo Pro and Team (the `full_coaching`
  entitlement); Free sees the panel locked with the upgrade modal. First
  release is read tools only ("basic commands").
- **E2. Daily budgets**, testing values in `services/assistant/policy.py`:
  Solo Pro 60k tokens/day, Team 200k, admins 1M. Revisit after a month of
  metering under `purpose="assistant"`.
- **E3. Coach tab**: stays. It is the right surface for its specific
  scenarios; the panel does not replace it (A4 no longer retires it).
- **E4. External MCP server (A5)**: after the pro library (pro-strats P4).

### Original questions, for the record

- **E1. Who gets it.** Proposal: everyone signed in, with tool scope by tier
  (Free: own matches, redacted findings; Solo Pro: full findings; Team: team
  and pro tools). Alternative: Solo Pro and up only.
- **E2. Daily budgets per tier** (the numbers in §5 are placeholders).
- **E3. Replace or keep the Team Coach tab's own chat** once the panel can
  be seeded with the team (proposal: replace, in A4).
- **E4. External MCP (A5) now or later.** Proposal: later, after the pro
  library exists, since that is the most distinctive thing to expose.
