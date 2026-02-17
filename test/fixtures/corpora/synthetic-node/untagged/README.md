![Taskflow API](https://img.shields.io/badge/version-2.1.0-blue.svg)
![Build](https://img.shields.io/github/actions/workflow/status/example/taskflow-api/ci.yml)
![License](https://img.shields.io/badge/license-MIT-green.svg)

# Taskflow API

A task management REST API built with Express and TypeScript. Taskflow provides a clean HTTP interface for creating, assigning, and tracking tasks across teams.

Node.js 18 or higher required.

## Features

JWT authentication, rate limiting, and structured logging included out of the box. The API is designed to be deployed standalone or integrated with the Taskflow MCP server for use with AI coding agents.

Server runs on port 3000 by default, though this is configurable via the `PORT` environment variable.

## Dependencies

The project is built on a minimal, production-tested dependency set:

| Package | Version |
|---|---|
| express | 4.18.2 |
| zod | 3.22.0 |
| pino | 8.15.0 |
| jsonwebtoken | ^9.0.0 |

Express 4.18.2 and Zod 3.22.0 are pinned to exact versions because the project's validation layer depends on their stable API surfaces.

Note: Unlike express 3.x, express 4 ships without a bundled router, body parser, or cookie session. All middleware must be registered explicitly. If you are migrating from express 3.x, consult the express migration guide before upgrading.

## Getting Started

Clone the repository and install dependencies, then copy the example environment file:

```bash
npm run dev
```

The server will start on port 3000. See `docs/guides/getting-started.md` for a full walkthrough.

## Configuration

All environment variables are read through the central configuration module at `src/config/index.ts`. See `docs/guides/configuration.md` for the full variable reference.

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
