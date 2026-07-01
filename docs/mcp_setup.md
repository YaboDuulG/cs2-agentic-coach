# DemoSage MCP Server Setup

## What is MCP?
The Model Context Protocol (MCP) lets AI agents (like Antigravity or Claude Desktop) call live tools against the DemoSage database — so your AI can query real match data, search pro tactics, and retrieve coaching notes during a conversation.

## Tools Available
| Tool | Description |
|------|-------------|
| `get_match_summary` | Match stats (map, rounds, kills) by match_id |
| `get_player_stats` | Per-player KDA, KAST, ADR by match_id |
| `get_round_breakdown` | Economy + winner per round |
| `search_pro_tactics` | Semantic RAG search of HLTV pro match knowledge |
| `get_coaching_notes` | AI-generated coaching output for a match |

## Running the Server
```bash
# From the project root
python -m agents.mcp_server
```

## Antigravity Configuration
Add to your workspace `.agents/mcp_servers.json`:
```json
{
  "servers": [
    {
      "name": "demosage",
      "transport": "stdio",
      "command": "python",
      "args": ["-m", "agents.mcp_server"],
      "cwd": "${workspaceRoot}",
      "env": {
        "DATABASE_URL": "${env:DATABASE_URL}"
      }
    }
  ]
}
```

## Claude Desktop Configuration
Add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "demosage": {
      "command": "python",
      "args": ["-m", "agents.mcp_server"],
      "cwd": "/path/to/cs2-agentic-coach",
      "env": {
        "DATABASE_URL": "your-postgres-url"
      }
    }
  }
}
```
