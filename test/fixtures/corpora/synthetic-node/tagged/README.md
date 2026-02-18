<!-- docalign:skip reason="badge_urls" -->
![Taskflow API](https://img.shields.io/badge/version-2.1.0-blue.svg)
![Build](https://img.shields.io/github/actions/workflow/status/example/taskflow-api/ci.yml)
![License](https://img.shields.io/badge/license-MIT-green.svg)
<!-- /docalign:skip -->

# Taskflow API

A task management REST API built with Express and TypeScript. Taskflow provides a clean HTTP interface for creating, assigning, and tracking tasks across teams.

<!-- docalign:skip reason="prerequisite_version" -->
Node.js 18 or higher required.
<!-- /docalign:skip -->

## Features

<!-- docalign:semantic id="C05" claim="JWT authentication, rate limiting, and structured logging included" -->
JWT authentication, rate limiting, and structured logging included out of the box. The API is designed to be deployed standalone or integrated with the Taskflow MCP server for use with AI coding agents.
<!-- /docalign:semantic -->

<!-- docalign:semantic id="C06" claim="Server runs on port 3000 by default" -->
Server runs on port 3000 by default, though this is configurable via the `PORT` environment variable.
<!-- /docalign:semantic -->

## Dependencies

The project is built on a minimal, production-tested dependency set:

| Package | Version |
|---|---|
<!-- docalign:check type="dep_version" -->
| express | 4.18.2 |
<!-- /docalign:check -->
<!-- docalign:check type="dep_version" -->
| zod | 3.22.0 |
<!-- /docalign:check -->
| pino | 8.15.0 |
| jsonwebtoken | ^9.0.0 |

Express 4.18.2 and Zod 3.22.0 are pinned to exact versions because the project's validation layer depends on their stable API surfaces.

<!-- docalign:skip reason="comparison_content" -->
Note: Unlike express 3.x, express 4 ships without a bundled router, body parser, or cookie session. All middleware must be registered explicitly. If you are migrating from express 3.x, consult the express migration guide before upgrading.
<!-- /docalign:skip -->

## Getting Started

Clone the repository and install dependencies, then copy the example environment file:

<!-- docalign:check type="command" -->
```bash
npm run dev
```
<!-- /docalign:check -->

The server will start on port 3000. See `docs/guides/getting-started.md` for a full walkthrough.

## Configuration

All environment variables are read through the central configuration module. See `docs/guides/configuration.md` for the full variable reference.

<!-- docalign:check type="path_reference" -->
Central config module: `src/config/index.ts`
<!-- /docalign:check -->

## Project Structure

```
src/
├── config/         # Central configuration module (src/config/index.ts)
├── routes/         # Route handlers
├── middleware/     # Auth, rate limiting, logging, error handling
├── services/       # Business logic (UserService, TaskService, NotificationService)
├── events/         # Event emitter singleton
├── db/             # Database client
└── mcp/            # MCP server
```

## Running Tests

```bash
npm test
```

## License

MIT
