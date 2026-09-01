"""
Discord stratbook sync (module 3).
===================================
Discord integration for the team stratbook via an **HTTP Interactions
endpoint** (slash commands, buttons, modals served over HTTPS) rather than a
gateway bot: no discord.js/nextcord/hikari dependency, and Cloud Run can keep
scaling to zero because Discord POSTs to us instead of us holding a socket.

Layout:
    security.py     - Ed25519 interaction signature verification + the
                      HMAC-signed team bind codes (cryptographic tenancy).
    interactions.py - FastAPI router for POST /api/discord/interactions.
                      DB work + outbox inserts ONLY — never Discord REST or
                      LLM calls inside the request.
    sync.py         - Worker-side outbox processor: Discord REST (httpx) and
                      the Gemini `ai_adapt` refinement.

Deviation from the original module brief: free-text @mention listening (a
gateway feature) is replaced by the in-thread `/strat adapt prompt:` slash
command — same capability (ask the AI to mutate the strat from Discord),
delivered over the interactions webhook instead of a persistent bot session.
"""
