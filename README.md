# DocAlign

Keep docs and code aligned.

DocAlign detects documentation drift by extracting verifiable claims from your docs (paths, commands, versions, routes, config values, links, and more) and checking them against the real repository state.

Built for open-source maintainers and teams shipping with AI coding agents.

## 60-Second Quickstart

Run directly with `npx` (no install required):

```bash
npx docalign scan
```

Check one file in detail:

```bash
npx docalign check README.md --verbose
```

If you want to contribute locally:

```bash
npm install
npm test
```

## Works with Claude Code, Cursor, Codex (Local Skill/MCP)

DocAlign runs locally as a CLI and can also run as a local MCP server for coding agents.

- **Claude Code**: use guided setup:

  ```bash
  docalign init
  ```

- **Cursor/Codex/other MCP-capable setups**: add DocAlign as a local MCP server:

  ```json
  {
    "mcpServers": {
      "docalign": {
        "command": "npx",
        "args": ["docalign", "mcp", "--repo", "."]
      }
    }
  }
  ```

This is local tooling (not a hosted cloud service).

## Core Capabilities

- Detects broken or stale doc claims (paths, versions, commands, routes, symbols, URLs)
- Validates links, anchors, nav configs, and cross-doc consistency
- Optional semantic verification for higher-level behavior/architecture claims
- Provides CLI + MCP workflows for editor agents and automation

## Essential Docs

1. [Getting Started](docs/getting-started.md)
2. [CLI Reference](docs/reference/cli.md)
3. [MCP Integration Guide](docs/guides/mcp-integration.md)
4. [Checks Reference](docs/reference/checks.md)
5. [Configuration Reference](docs/reference/configuration.md)
6. [Troubleshooting](docs/troubleshooting.md)

## Common Commands

```bash
docalign scan
docalign check <file>
docalign extract [file]
docalign fix [file]
docalign status
docalign configure
docalign init
docalign viz
docalign mcp
docalign help
```

See full command details in the [CLI Reference](docs/reference/cli.md).

## Contributing

- Start here: [Contributing Architecture](docs/contributing/architecture.md)
- Testing: [Contributing Testing](docs/contributing/testing.md)

## License

MIT
