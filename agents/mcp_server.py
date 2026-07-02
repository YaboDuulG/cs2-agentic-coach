"""
DemoSage MCP Server
====================
Exposes DB tools and AI coaching context to compatible MCP clients
(Antigravity, Claude Desktop, Cursor, etc.).

Transport: stdio (run as subprocess, not HTTP)
Launch: python -m agents.mcp_server
"""

import asyncio
import json
import logging
from typing import Any

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import (
    CallToolResult,
    ListResourcesResult,
    ListToolsResult,
    ReadResourceResult,
    Resource,
    TextContent,
    Tool,
)

logger = logging.getLogger(__name__)

app = Server("demosage")


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------

@app.list_tools()
async def list_tools() -> ListToolsResult:
    """Docstring for list_tools."""
    return ListToolsResult(tools=[
        Tool(
            name="get_match_summary",
            description="Get a high-level summary of a parsed CS2 match including round count, kills, map, and player stats.",
            inputSchema={
                "type": "object",
                "properties": {
                    "match_id": {"type": "string", "description": "The UUID of the match"}
                },
                "required": ["match_id"]
            }
        ),
        Tool(
            name="get_player_stats",
            description="Get per-player stats for a match: kills, deaths, KAST, headshot%, ADR.",
            inputSchema={
                "type": "object",
                "properties": {
                    "match_id": {"type": "string"},
                    "steam_id": {"type": "string", "description": "Optional: filter to one player"}
                },
                "required": ["match_id"]
            }
        ),
        Tool(
            name="get_round_breakdown",
            description="Get round-by-round breakdown: economy, winner side, first contact outcome.",
            inputSchema={
                "type": "object",
                "properties": {
                    "match_id": {"type": "string"},
                    "round_num": {"type": "integer", "description": "Optional: get a single round"}
                },
                "required": ["match_id"]
            }
        ),
        Tool(
            name="search_pro_tactics",
            description="Semantic search the HLTV pro match knowledge base. Returns relevant pro round patterns for a given tactical situation.",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Tactical question or situation description"},
                    "map_name": {"type": "string", "description": "Optional map filter e.g. de_mirage"},
                    "limit": {"type": "integer", "default": 5}
                },
                "required": ["query"]
            }
        ),
        Tool(
            name="get_coaching_notes",
            description="Retrieve the AI-generated coaching notes for a completed match.",
            inputSchema={
                "type": "object",
                "properties": {
                    "match_id": {"type": "string"}
                },
                "required": ["match_id"]
            }
        ),
    ])


@app.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> CallToolResult:
    """Docstring for call_tool."""
    from sqlalchemy import text

    from db.database import SessionLocal
    from db.models import Match, Round

    db = SessionLocal()
    try:
        if name == "get_match_summary":
            match_id = arguments["match_id"]
            match = db.query(Match).filter(Match.match_id == match_id).first()
            if not match:
                return CallToolResult(content=[TextContent(type="text", text=f"Match {match_id} not found.")])

            kill_count = db.execute(text("SELECT COUNT(*) FROM kills WHERE match_id = :mid"), {"mid": match_id}).scalar()
            db.execute(text("SELECT COUNT(*) FROM rounds WHERE match_id = :mid"), {"mid": match_id}).scalar()

            summary = {
                "match_id": match_id,
                "map": match.map_name,
                "status": match.status,
                "total_rounds": match.total_rounds,
                "total_kills": kill_count,
                "tickrate": match.tickrate,
                "created_at": match.created_at.isoformat() if match.created_at else None,
            }
            if match.player_stats_json:
                summary["player_stats"] = json.loads(match.player_stats_json)

            return CallToolResult(content=[TextContent(type="text", text=json.dumps(summary, indent=2))])

        elif name == "get_player_stats":
            match_id = arguments["match_id"]
            match = db.query(Match).filter(Match.match_id == match_id).first()
            if not match:
                return CallToolResult(content=[TextContent(type="text", text=f"Match {match_id} not found.")])

            if match.player_stats_json:
                stats = json.loads(match.player_stats_json)
                steam_id = arguments.get("steam_id")
                if steam_id:
                    stats = {k: v for k, v in stats.items() if k == steam_id}
                return CallToolResult(content=[TextContent(type="text", text=json.dumps(stats, indent=2))])
            return CallToolResult(content=[TextContent(type="text", text="No player stats available yet.")])

        elif name == "get_round_breakdown":
            match_id = arguments["match_id"]
            round_num = arguments.get("round_num")

            q = db.query(Round).filter(Round.match_id == match_id)
            if round_num:
                q = q.filter(Round.round_num == round_num)
            rounds = q.order_by(Round.round_num).all()

            data = [{
                "round_num": r.round_num,
                "winner": r.winner_side,
                "t_money": r.t_money,
                "ct_money": r.ct_money,
                "round_type": r.round_type,
            } for r in rounds]

            return CallToolResult(content=[TextContent(type="text", text=json.dumps(data, indent=2))])

        elif name == "search_pro_tactics":
            query_text = arguments["query"]
            limit = arguments.get("limit", 5)

            try:
                from db.rag import retrieve_similar_chunks
                results = retrieve_similar_chunks(db, query=query_text, limit=limit, source="hltv_pro_match")
                return CallToolResult(content=[TextContent(type="text", text=json.dumps(results, indent=2))])
            except Exception as e:
                return CallToolResult(content=[TextContent(type="text", text=f"RAG search error: {e}")])

        elif name == "get_coaching_notes":
            match_id = arguments["match_id"]
            match = db.query(Match).filter(Match.match_id == match_id).first()
            if not match:
                return CallToolResult(content=[TextContent(type="text", text=f"Match {match_id} not found.")])
            if not match.coaching_notes:
                return CallToolResult(content=[TextContent(type="text", text="Coaching notes not yet generated for this match.")])
            return CallToolResult(content=[TextContent(type="text", text=match.coaching_notes)])

        else:
            return CallToolResult(content=[TextContent(type="text", text=f"Unknown tool: {name}")])

    finally:
        db.close()


# ---------------------------------------------------------------------------
# Resources
# ---------------------------------------------------------------------------

@app.list_resources()
async def list_resources() -> ListResourcesResult:
    """Docstring for list_resources."""
    return ListResourcesResult(resources=[
        Resource(
            uri="demosage://meta/status",
            name="DemoSage Platform Status",
            description="Live counts of matches, users, and system health.",
            mimeType="application/json",
        )
    ])


@app.read_resource()
async def read_resource(uri: str) -> ReadResourceResult:
    """Docstring for read_resource."""
    from sqlalchemy import text

    from db.database import SessionLocal

    if uri == "demosage://meta/status":
        db = SessionLocal()
        try:
            match_count = db.execute(text("SELECT COUNT(*) FROM matches")).scalar()
            complete_count = db.execute(text("SELECT COUNT(*) FROM matches WHERE status = 'complete'")).scalar()
            team_count = db.execute(text("SELECT COUNT(*) FROM teams")).scalar()

            status = {
                "total_matches": match_count,
                "complete_matches": complete_count,
                "total_teams": team_count,
                "service": "DemoSage",
                "version": "1.0.0-v2",
            }
            return ReadResourceResult(contents=[TextContent(type="text", text=json.dumps(status, indent=2))])
        finally:
            db.close()

    raise ValueError(f"Unknown resource: {uri}")


# ---------------------------------------------------------------------------
# Entry Point
# ---------------------------------------------------------------------------

async def main():
    """Docstring for main."""
    async with stdio_server() as (read_stream, write_stream):
        await app.run(read_stream, write_stream, app.create_initialization_options())


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
