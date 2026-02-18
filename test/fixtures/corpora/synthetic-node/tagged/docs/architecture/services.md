# Service Layer

This document describes the service classes in `src/services/` and their interactions.

---

## Overview

The service layer contains all business logic. Route handlers are intentionally thin — they parse input, call a service method, and return the result. Services own the database queries, validation rules, and domain event emission.

Three services are currently implemented:

- **UserService** — user account management
- **TaskService** — task lifecycle management
- **NotificationService** — event-driven notification dispatch

---

## UserService

`UserService` handles user creation, lookup, and credential management.

The `createUser({ name, email })` method validates the input, hashes the provided password with bcrypt using a cost factor of 12, and inserts the new record into the database. Using cost factor 12 is a deliberate trade-off between hashing time (approximately 300ms on typical hardware) and brute-force resistance.

<!-- docalign:semantic id="C46" claim="UserService uses bcrypt with cost factor 12" -->
`UserService` uses bcrypt with cost factor 12. This choice was made to align with OWASP recommendations for interactive login flows.
<!-- /docalign:semantic -->

---

## TaskService

`TaskService` handles task CRUD operations and emits domain events when task status changes.

<!-- docalign:semantic id="C44" claim="TaskService emits task.completed event when task status set to done" -->
When a task's status is set to `done`, `TaskService` emits the `task.completed` event on the shared event emitter. This is the only domain event currently in use. The event payload includes the full task object.
<!-- /docalign:semantic -->

<!-- docalign:skip reason="illustrative_sequence_diagram" -->
The sequence of events during a task completion is as follows: the route handler calls `TaskService.completeTask(taskId)`, which updates the database row, then calls `emitter.emit('task.completed', task)`. The `NotificationService` listener, registered at startup, receives the event asynchronously.
<!-- /docalign:skip -->

---

## NotificationService

<!-- docalign:semantic id="C45" claim="NotificationService subscribes to task.completed" -->
`NotificationService` subscribes to `task.completed` on startup and dispatches notifications when a task is completed. Currently it sends in-app notifications (stored in the database); email and webhook delivery are planned for a future version.
<!-- /docalign:semantic -->

The subscription is established in the `NotificationService` constructor (or `init()` method). The service calls `emitter.on('task.completed', handler)` during application startup. This means notifications are delivered as long as the process is running — there is no persistence or retry mechanism for in-flight notifications if the process crashes.

---

## Event Flow

The interaction between `TaskService` and `NotificationService` is mediated entirely through the event emitter. Neither service holds a direct reference to the other.

This design is intentional: it makes each service independently testable. In unit tests, `TaskService` can be tested without a `NotificationService` instance, and vice versa.

The shared event emitter (`src/events/emitter.ts`) is a Node.js `EventEmitter` singleton. It is not persisted and does not survive process restarts.
