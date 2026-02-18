# Architecture Overview

This document describes the high-level structure of the Taskflow API and explains the design decisions that shaped it.

---

## Request Pipeline

Every HTTP request passes through a fixed sequence of middleware layers before reaching a route handler:

<!-- docalign:semantic id="C37" claim="Request pipeline: Logger → Auth → RateLimit → Route Handler → ErrorHandler" -->
```
Logger → Auth → RateLimit → Route Handler → ErrorHandler
```

This ordering is intentional:

1. **Logger** runs first so that every request — including rejected ones — produces a structured log line with a unique `requestId`.
2. **Auth** runs before route handlers so that unauthenticated requests are rejected early, before any business logic executes.
3. **RateLimit** runs after auth so that authenticated users can be rate-limited by user identity (not just by IP) if needed in future.
4. **Route Handler** executes the business logic.
5. **ErrorHandler** is registered last so it catches all unhandled errors from any layer above it.
<!-- /docalign:semantic -->

---

## Service Layer

<!-- docalign:check type="path_reference" -->
All business logic lives in `src/services/`. Route handlers are thin — they parse the request, call a service method, and return the result.
<!-- /docalign:check -->

Services are responsible for data validation beyond schema checks, database queries, and event emission.

The current services are:

- **UserService** — user creation, lookup, and password management
- **TaskService** — task CRUD and lifecycle events
- **NotificationService** — reacts to task lifecycle events and dispatches notifications

---

## Event System

<!-- docalign:semantic id="C39" claim="Notifications use an event-driven model via src/events/emitter.ts" -->
Notifications use an event-driven model via `src/events/emitter.ts`. Rather than calling `NotificationService` directly from `TaskService`, task lifecycle changes emit domain events onto a shared `EventEmitter` instance. `NotificationService` subscribes to those events on startup.
<!-- /docalign:semantic -->

This design decouples the task and notification concerns. Adding a new subscriber (e.g. a WebSocket broadcast service) requires no changes to `TaskService`.

<!-- docalign:skip reason="historical_context" -->
Before v2.0, the app used a single-file monolith — all route handlers, business logic, and notification calls were written inline. The service layer and event system were introduced in v2.0 to make the codebase testable and extensible.
<!-- /docalign:skip -->

<!-- docalign:skip reason="future_plans" -->
We plan to add Redis caching in v3 to reduce database load on the task list endpoint.
<!-- /docalign:skip -->

---

## Database

The API uses PostgreSQL via the `pg` driver. The database client is a connection pool exported from `src/db/client.ts`. All service classes and the MCP server share this single pool.

Migrations are managed with `node-pg-migrate`. Run `npm run migrate` to apply pending migrations.

---

## MCP Server

<!-- docalign:skip -->
The MCP server (`src/mcp/`) runs as a separate process but shares the database connection with the REST API. See [MCP Guide](../guides/mcp.md) for setup and tool documentation.
<!-- /docalign:skip -->
