# Discord integration: how it works, how to set it up, how to test it

Status on 2026-10-02: **the code is complete and tested; production is not
configured.** The live interactions endpoint answers
`401 DISCORD_PUBLIC_KEY is not configured`, no `DISCORD_*` secret exists in
Secret Manager, and no Discord application is registered against the API.
Section 3 is the list of things only the owner can do.

## 1. What it does

DemoSage talks to Discord through an **HTTP interactions endpoint**, not a
gateway bot: Discord POSTs slash commands and button presses to
`POST /api/discord/interactions`, signed with the application's Ed25519 key.
Anything slow (creating threads, posting embeds, Gemini) is written to the
`sync_outbox` table and done by the worker, so a Discord outage never blocks a
request.

**The bot is not "on".** It never sees chat as it happens and never answers a
message or a mention; it acts only when someone runs a `/strat` command or
presses a button. The way to get a channel's discussion into the stratbook is
`/strat ingest`, which reads the channel's history on demand.

### Channel groups: one channel per map

A team binds a Discord **channel group** (a category). Every text channel in
it whose name is a map becomes that map's channel:

| Channel name | Map |
|---|---|
| `#mirage`, `#de-mirage`, `#de_mirage`, `#🟧│mirage-strats` | `de_mirage` |
| `#dust2`, `#dust-2`, `#d2` | `de_dust2` |
| `#inferno`, `#nuke`, `#ancient`, `#anubis`, `#vertigo`, `#overpass`, `#train` | `de_<name>` |
| `#training`, `#general`, voice channels, channels in another group | ignored |

Matching is by whole word (`services/discord_bot/channels.py`
`map_from_name`), so `#training` is not Train.

- A strat's thread opens in the channel for its map. A map with no channel
  goes to the channel where `/strat bind` ran.
- `/strat create` and `/strat view` run inside a map channel need no `map:`.
- Bound from a channel that is not in a group, the team is in single-channel
  mode: everything goes to that channel (the behaviour before 2026-10-02).

### Commands

| Command | Where | What |
|---|---|---|
| `/strat bind code:<code>` | any channel of the map group | Binds the server and the group to the team. Code from Team Hub → Stratbook → Discord. Captain only. |
| `/strat channels` | anywhere | Lists channel → map and queues a refresh. |
| `/strat ingest` | a text channel or thread | Reads everything posted since the last ingest (the first run reads the channel from its first message), has Gemini pull out the strategies the conversation describes, saves them to the team's knowledge base (Team Hub → Stratbook → "Ingested from Discord", and the team coach), and replies with what it found. In a map channel the strategies are filed under that map. |
| `/strat create title:<t> [map] [side] [buy]` | a map channel | New DRAFT strat; thread opens in that map's channel. |
| `/strat view [map] [name]` | a map channel | Strats for the map with status and revision. |
| `/strat analyze round_id:<n>` | anywhere | Coaching findings for a round of the latest team match. |
| `/strat adapt prompt:<…>` | a strat's thread | Gemini rewrites the strat; a new `ai` revision. |
| **Approve** button | a strat's thread | `IN_REVIEW` → `ACTIVE`. Appears when the strat is submitted for review. |

### How `/strat ingest` reads a channel without a gateway

Discord lets a bot read a channel's **history** over REST (`GET
/channels/{id}/messages`) as long as the application has the **Message
Content** intent and the bot has **Read Message History** in that channel. The
intent is a checkbox in the developer portal (no review under 100 servers);
it is the same switch a gateway bot would need, but no connection is held.

The worker job (`services/discord_bot/ingest.py`) reads pages of 100 messages
from the cursor (`team_discord_ingest_cursors.last_message_id`), drops bot,
webhook and system messages, sends the conversation to Gemini in chunks of
about 7,000 characters with a schema that returns a list of strategies (title,
map, side, summary, steps) and is told to return nothing for idle talk, saves
each strategy as a `team_strategy` knowledge row with an embedding, and moves
the cursor one page at a time, so a failure never re-reads a saved page. A run
reads up to six pages and re-enqueues itself until it has caught up; each run
replies in the channel. Without a Gemini key the channel is left unread rather
than skipped. Gemini calls are metered under `purpose=ingest` for the team.

### Not built

Live listening: the bot does not react to messages or mentions as they are
posted. That needs a gateway connection held by the worker; `/strat ingest` is
the deliberate alternative.

## 2. How to test

### 2.1 Automated, no Discord needed

```
pytest tests/test_discord_security.py tests/test_discord_interactions.py \
       tests/test_discord_sync.py tests/test_discord_channels.py \
       tests/test_discord_ingest.py tests/test_discord_e2e.py \
       tests/test_discord_doctor.py -v
```

| Suite | Proves |
|---|---|
| `test_discord_security.py` | Ed25519 verification and HMAC bind codes, including tampering. |
| `test_discord_interactions.py` | Each `/strat` subcommand and the Approve button, unsigned local mode. |
| `test_discord_sync.py` | Worker jobs: thread + embed, status lines, Gemini adapt, requeue on failure. |
| `test_discord_channels.py` | Channel-name → map matching, binding a group, map defaulting, where threads open, the web status/bind/unbind routes, the ingestion webhook failing closed. |
| `test_discord_e2e.py` | The whole life of a strat with **real signatures enforced**: bind code on the web → `/strat bind` in `#mirage` → worker maps the group → `/strat create` in `#de-inferno` → thread in that channel → submit for review on the web → Approve in Discord → `ACTIVE`. Also a web-made strat landing in its map channel, and recovery from a Discord outage. |
| `test_discord_ingest.py` | `/strat ingest`: first run from the beginning, later runs only what is new, "nothing new", long channels read in chained runs, a failure mid-run keeps the saved pages and resumes, no Gemini key leaves the channel unread, the rows appear in the web list. |
| `test_discord_doctor.py` | The decisions behind each line of the doctor script. |

These run in CI on every push. `tests/discord_fakes.py` holds the fake
Discord REST API, the request signer and a sample server layout.

### 2.2 Live configuration: the doctor

```
python scripts/discord_doctor.py                     # settings, application, endpoint
python scripts/discord_doctor.py --guild <server id> # plus commands and channel group there
```

Read-only. One PASS/FAIL line per check, exit code 1 on any failure:

- the four settings are present and the public key is 64 hex characters;
- the bot token is valid and belongs to `DISCORD_APP_ID`;
- the application's public key equals `DISCORD_PUBLIC_KEY`;
- the application's Interactions Endpoint URL is our API;
- the Message Content intent is on (without it `/strat ingest` reads empty
  messages);
- the deployed API refuses an unsigned request **by signature** (proves the
  key reached Cloud Run; today it fails with "not configured");
- `/strat` is registered with every subcommand;
- with `--guild`: the bot is in the server, and which group has map channels
  and how each channel resolves.

### 2.3 Live, by hand (about five minutes, after section 3)

1. Team Hub → Stratbook → Discord: the card says **Not connected** and shows
   three steps. Press **Get bind code** and copy the command.
2. In Discord, in any channel of the map group: paste it. Expect "Bound this
   server to **<team>**. Every channel in this channel group…".
3. `/strat channels`: expect one line per map channel.
4. Reload the web card: **Connected**, with the same list.
5. In `#mirage`: `/strat create title:Test A split`. Within about ten seconds
   a thread `[strat] Test A split` opens in `#mirage` with an embed.
6. On the web, open the strat and press **Send for review**. The thread gets
   a status line and an embed with an **Approve** button.
7. Press **Approve** in Discord. The button disappears, the message reads
   "approved — now ACTIVE", and the web shows the strat as Active.
8. In `#mirage`, after a few lines of real strat talk: `/strat ingest`. Expect
   "Reading #mirage from the beginning…" at once and, within a minute, "Read N
   messages from #mirage, saved M strategies" with the titles. They appear
   under Team Hub → Stratbook → Ingested from Discord. Run it again: "Nothing
   new in #mirage since the last ingest."

If step 5 produces no thread, the worker is not draining the outbox: check
the `demosage-worker-staging` logs for `Outbox item … failed`.

## 3. Owner setup (once)

1. **Create the application**: https://discord.com/developers/applications →
   New Application. Copy **Application ID** and **Public Key** (General
   Information) and create a **Bot** → Reset Token → copy it.
2. **Put the values in the root `.env`** (never in a tracked file):
   ```
   DISCORD_APP_ID=…
   DISCORD_PUBLIC_KEY=…
   DISCORD_BOT_TOKEN=…
   DISCORD_WEBHOOK_SECRET=<any long random string>
   ```
3. **Create the secrets and attach them to Cloud Run.** The API needs the
   public key and the bind secret; the worker needs the bot token (and the
   bind secret is harmless there). The deploy workflow must list them or the
   next deploy drops them:
   ```bash
   # Git Bash, from the repo root. printf, not echo: a trailing newline in a
   # secret breaks the signature check the same way the CR broke Vercel env.
   set -a; . ./.env; set +a
   for n in DISCORD_PUBLIC_KEY DISCORD_BOT_TOKEN DISCORD_WEBHOOK_SECRET; do
     printf '%s' "${!n}" | gcloud secrets create "$n" --data-file=-
   done
   ```
   then add `DISCORD_PUBLIC_KEY=DISCORD_PUBLIC_KEY:latest,DISCORD_WEBHOOK_SECRET=DISCORD_WEBHOOK_SECRET:latest`
   to the API's `--set-secrets` and `DISCORD_BOT_TOKEN=DISCORD_BOT_TOKEN:latest`
   to the worker's in `.github/workflows/deploy-staging.yml`, and deploy.
   (Not done in the workflow yet: listing a secret that does not exist fails
   the deploy.)
4. **Set the Interactions Endpoint URL** (General Information) to
   `https://demosage-api-staging-dsr6wo6mta-uc.a.run.app/api/discord/interactions`.
   Discord sends a signed PING and only saves if we answer; this is the first
   live proof.
5. **Invite the bot** with the URL the doctor prints (scopes `bot` and
   `applications.commands`; permissions View Channels, Send Messages, Create
   Public Threads, Send Messages in Threads, Embed Links, Read Message
   History). The bot must be able to see the map group. Under **Bot →
   Privileged Gateway Intents** switch on **Message Content**; `/strat ingest`
   gets empty messages without it.
6. **Register the commands**: `python scripts/register_discord_commands.py <server id>`
   (instant for that server; without the id it is global and takes up to an
   hour).
7. `python scripts/discord_doctor.py --guild <server id>` until every line
   passes, then section 2.3.

## 4. Where things are

| Concern | Path |
|---|---|
| Signature check, bind codes | `services/discord_bot/security.py` |
| Slash commands, Approve button | `services/discord_bot/interactions.py` |
| Channel-name matching, map-channel cache | `services/discord_bot/channels.py` |
| Worker jobs, the only Discord REST caller | `services/discord_bot/sync.py` |
| `/strat ingest`: history reading, Gemini extraction, cursor | `services/discord_bot/ingest.py` |
| Outbox claim / requeue | `db/outbox.py`, `services/worker/runner.py` |
| Tables | `team_discord_links` (+ `category_id`), `team_discord_channels`, `team_discord_ingest_cursors`, `sync_outbox` |
| Web status / bind code / unbind | `GET·POST·DELETE /api/teams/{id}/discord`, `components/teams/DiscordCard.tsx` |
| Command definitions | `scripts/register_discord_commands.py` |
