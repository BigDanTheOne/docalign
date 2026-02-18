# Changelog

All notable changes to Taskflow API are recorded here. This file documents historical releases and must not be interpreted as a description of the current state of the codebase.

---

<!-- docalign:skip reason="historical_record" -->
## [2.1.0] — 2026-01-10

### Added
- MCP server (`src/mcp/server.ts`) exposing task management tools to AI coding agents
- `.claude/mcp.json` configuration for Claude Code integration
- `get_tasks`, `create_task`, `complete_task`, and `get_users` tool registrations

### Changed
- Rate limit window changed from 10 minutes to 15 minutes per IP

---

## [2.0.0] — 2025-06-01

### Breaking Changes
- Upgraded express to 4.18.2 (was 4.17.1)
- Upgraded zod to 3.22.0 (was 3.19.1)
- Removed legacy `/api/v0` route prefix; all endpoints now under `/api/v1`
- Config module moved from `src/app-config.ts` to `src/config/index.ts`

### Added
- Event-driven notification system via `src/events/emitter.ts`
- `NotificationService` subscribing to `task.completed` events
- `RATE_LIMIT_MAX` environment variable for configurable rate limiting

### Fixed
- JWT tokens no longer issued without expiry; all tokens now expire after 24 hours

---

## [1.5.0] — 2025-01-15

### Added
- `GET /api/v1/users` route for listing all users (admin only)
- `PATCH /api/v1/users/:id` route for partial user updates
- Structured logging via pino 8.11.0

### Changed
- `PORT` default changed from 8080 to 3000
- bcrypt cost factor raised from 10 to 12

---

## [1.0.0] — 2024-08-01

### Initial release

- REST API for task management with Express 4.17.1
- `GET /api/v0/tasks`, `POST /api/v0/tasks`, `DELETE /api/v0/tasks/:id`
- JWT authentication with no token expiry (deprecated in v2.0.0)
- Basic error handler at `src/errorHandler.ts` (moved in v2.0.0)
- PostgreSQL via `pg` client
- `DATABASE_URL` and `JWT_SECRET` environment variables
<!-- /docalign:skip -->
