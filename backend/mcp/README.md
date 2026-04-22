# NetFlow MCP Server

Exposes the NetFlow AI pipeline as MCP tools callable from Claude Desktop or any MCP-compatible host.

## Tools

| Tool | Description |
|---|---|
| `search_properties` | Full 3-agent pipeline — 10 ranked properties |
| `get_market_data` | Live ZIP market snapshot (FRED + RentCast) |
| `score_property` | Score a single property 0–100 |
| `analyse_risk` | Risk profile with factors and mitigations |
| `chat_with_property` | Property Q&A with conversation memory |
| `validate_prompt` | Run UserAgent security pipeline |

## Security — PromptGuard

Every string argument passed to any tool is screened by `PromptGuard` **before** the tool body executes. This means:

- Injection attempts via tool arguments are blocked at the MCP layer
- The same 14 injection patterns used by the UserAgent apply here
- Sanitisation (HTML strip, unicode normalise) runs on every string even when clean
- Blocked calls are logged with `tool_name`, `field`, `pattern_code`, and `session_id`

## Running

**stdio (Claude Desktop):**
```
cd C:\netflow
python -m backend.mcp.server
```

**SSE/HTTP (web clients):**
```
python -m backend.mcp.server --transport sse --port 8001
```

Health check: `GET http://localhost:8001/mcp/health`
Tool list:    `GET http://localhost:8001/mcp/tools`

## Claude Desktop Setup

Copy `claude_desktop_config.json` contents into your Claude Desktop config:
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Mac:      `~/Library/Application Support/Claude/claude_desktop_config.json`
