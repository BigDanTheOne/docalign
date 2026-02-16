# Session Context

**Session ID:** 8698195b-1f0f-4bac-9329-b78bf5c7749c

**Commit Message:** Base directory for this skill: /Users/kotkot/.claude/skills/drawio

# Dr

## Prompt

I like C. What about a picture?

---

Base directory for this skill: /Users/kotkot/.claude/skills/drawio

# Draw.io Skill

AI-powered Draw.io diagram generation with real-time browser preview for Claude Code.

## Quick Start

| What you want to do | Command | Description |
|---------------------|---------|-------------|
| Create new diagram | `/drawio create ...` | Natural language → diagram |
| Replicate image | `/drawio replicate ...` | Image → A-H → diagram |
| Edit diagram | `/drawio edit ...` | Modify existing diagram |

> **Tip**: Use `/drawio` followed by keywords like "create", "replicate", "edit" to trigger different workflows.

## Features

- **Design System** - Unified visual language with themes, tokens, and semantic shapes
- **Real-time Preview** - Diagrams update in browser as Claude creates them
- **Version History** - Restore previous diagram versions
- **Natural Language** - Describe diagrams in plain text
- **Cloud Architecture** - AWS, GCP, Azure with official icons
- **Animated Connectors** - Dynamic connector animations
- **Semantic Shapes** - Auto-select shapes based on node type
- **Math Typesetting** - LaTeX/AsciiMath equations in labels
- **IEEE Academic Style** - Publication-ready diagrams

## Design System

The skill includes a unified design system providing consistent visual language:

### Themes

| Theme | Use Case |
|-------|----------|
| **Tech Blue** | Software architecture, DevOps (default) |
| **Academic Color** ⭐ | Academic papers, research (recommended) |
| **Academic** | IEEE grayscale print only |
| **Nature** | Environmental, lifecycle diagrams |
| **Dark Mode** | Presentations, slides |

### Semantic Shapes

Automatic shape selection based on node type:

```yaml
nodes:
  - id: api
    label: API Gateway
    type: service     # → Rounded rectangle

  - id: db
    label: User Database
    type: database    # → Cylinder

  - id: check
    label: Valid?
    type: decision    # → Diamond
```

### Typed Connectors

| Type | Style | Usage |
|------|-------|-------|
| `primary` | Solid 2px, filled arrow | Main flow |
| `data` | Dashed 2px, filled arrow | Data/async flow |
| `optional` | Dotted 1px, open arrow | Weak relation |
| `dependency` | Solid 1px, diamond | Dependencies |

### 8px Grid System

All spacing and positions align to 8px grid for professional results:
- Node margin: 32px minimum
- Container padding: 24px
- Canvas padding: 32px

→ [Full Design System Documentation](docs/design-system/README.md)

## Installation

MCP server auto-configures on first use:

```json
{
  "command": "npx",
  "args": ["--yes", "@next-ai-drawio/mcp-server@latest"]
}
```

Default port: `6002` (auto-increments if in use)

For manual setup, see [scripts/](scripts/).

## MCP Tools

| Tool | Description |
|------|-------------|
| `start_session` | Opens browser with real-time preview |
| `create_new_diagram` | Create diagram from XML |
| `edit_diagram` | Edit by ID-based operations |
| `get_diagram` | Get current diagram XML |
| `export_diagram` | Save to `.drawio` file |

Details: [docs/mcp-tools.md](docs/mcp-tools.md)

## Workflows

### `/drawio create` - Create from Scratch

Create diagrams from natural language descriptions.

```
/drawio create a login flowchart with validation and error handling
```

**A-H format**: Optional (use `--structured` for complex diagrams)

→ [Full workflow](workflows/create.md)

### `/drawio replicate` - Replicate Existing

Recreate images/screenshots using structured A-H extraction.

```
/drawio replicate
【领域】软件架构
[Upload image]
```

**A-H format**: Required

→ [Full workflow](workflows/replicate.md)

### `/drawio edit` - Modify Diagram

Edit existing diagrams with natural language instructions.

```
/drawio edit
Change "User Service" to "Auth Service"
Make database nodes green
```

**A-H format**: Optional (use for structural changes)

→ [Full workflow](workflows/edit.md)

## Documentation

### Design System

| Topic | File |
|-------|------|
| Design System Overview | [docs/design-system/README.md](docs/design-system/README.md) |
| Design Tokens | [docs/design-system/tokens.md](docs/design-system/tokens.md) |
| Themes | [docs/design-system/themes.md](docs/design-system/themes.md) |
| Semantic Shapes | [docs/design-system/shapes.md](docs/design-system/shapes.md) |
| Connectors | [docs/design-system/connectors.md](docs/design-system/connectors.md) |
| Icons | [docs/design-system/icons.md](docs/design-system/icons.md) |
| Formulas | [docs/design-system/formulas.md](docs/design-system/formulas.md) |
| Specification Format | [docs/design-system/specification.md](docs/design-system/specification.md) |

### Reference

| Topic | File |
|-------|------|
| Math Typesetting | [docs/math-typesetting.md](docs/math-typesetting.md) |
| IEEE Diagrams | [docs/ieee-diagrams.md](docs/ieee-diagrams.md) |
| Usage Examples | [docs/examples.md](docs/examples.md) |
| XML Format | [docs/xml-format.md](docs/xml-format.md) |
| MCP Tools | [docs/mcp-tools.md](docs/mcp-tools.md) |

## Architecture

```
Claude Code <--stdio--> MCP Server <--http--> Browser (draw.io)
```

1. Ask Claude to create a diagram
2. Claude calls `start_session` to open browser
3. Claude generates diagram XML
4. Diagram appears in real-time!

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "d.setId is not a function" | Use numeric `mxCell` IDs only |
| Port already in use | Server auto-tries ports 6002-6020 |
| "No active session" | Call `start_session` first |
| Browser not updating | Check URL has `?mcp=` parameter |
| Math not rendered | Enable `Extras > Mathematical Typesetting` |

## Links

- [Homepage](https://next-ai-drawio.jiang.jp)
- [GitHub Repository](https://github.com/DayuanJiang/next-ai-draw-io)
- [MCP Server Documentation](https://github.com/DayuanJiang/next-ai-draw-io/tree/main/packages/mcp-server)

## License & Author

- **License**: Apache-2.0
- **Author**: DayuanJiang
- **Skill Version**: 1.1.0


ARGUMENTS: Create a clean, modern diagram for a Twitter post showing an autonomous AI development pipeline. The diagram should be horizontal, dark background (#1a1a2e or similar dark theme), with clean rounded boxes and connecting arrows.

Layout from left to right:

Left side: A single box labeled "Solo Founder" with a small Telegram icon or label below it, with subtitle "Approves twice. Goes to sleep."

Two thin arrows going right from the founder to two boxes labeled "Approve Direction" and "Approve Spec" — these should be highlighted in a warm color (orange/amber) to show they're the human gates.

Then a large arrow pointing right to a section labeled "Fully Autonomous" containing 7 agent boxes in a clean grid or flow:
- Chief (top)
- Orchestrator (below Chief)
- Then 5 agents in a row: PM, Tech Lead, Critic, GTM, Researcher

Below the agents, show the pipeline flow as a horizontal chain of rounded pill-shaped stages:
Debate → Define → Spec → Plan → Build → Code Review → Verify → Ship

At the far right: a box or icon representing "Shipped PR" with a checkmark, with subtitle "Merged to main. Tests pass."

The overall feel should be: one person on the left, a powerful autonomous system in the middle, shipped code on the right. Clean, minimal, modern. Good contrast for Twitter dark and light mode.

## Summary

Done. I created the diagram file at `_team/docs/autonomous-os-diagram.drawio`.

**To use it:**
1. Open [app.diagrams.net](https://app.diagrams.net) in your browser
2. File → Open From → Device → select the `.drawio` file
3. It's a dark-themed diagram showing:
   - **Left**: Solo Founder (Telegram) with 2 amber approval gates
   - **Center**: "Fully Autonomous" zone with the 7-agent hierarchy (Chief → Orchestrator → 5 personas)
   - **Middle row**: Pipeline stages as pills (Debate → Define → Spec → Plan → Build → Review → Verify → Ship)
   - **Lower rows**: Harness features (EXEC_PLAN.md, Isolated Dev Env, Remediation Lint) and infrastructure (Worktrees, Mem0, SQLite engine)
   - **Bottom**: "One founder. Seven agents. Ship while sleeping." + "Powered by @OpenClaw"

4. Export as PNG (File → Export As → PNG, set scale to 2x for crisp Twitter display)

You may want to tweak positions or colors once you see it. The layout should be close but draw.io auto-layout might shift things slightly.

## Key Actions

- - **Skill**: 
- - **Read**: /Users/kotkot/.claude/skills/drawio/workflows/create.md
- - **Read**: /Users/kotkot/.claude/skills/drawio/docs/design-system/themes.md
- - **Read**: /Users/kotkot/.claude/skills/drawio/docs/design-system/specification.md
- - **mcp__claude-in-chrome__tabs_context_mcp**: 
- - **Write**: /Users/kotkot/Discovery/docalign/_team/docs/autonomous-os-diagram.drawio
