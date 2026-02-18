# Tasks API

The Tasks API provides endpoints for creating and managing tasks. All endpoints require authentication.

<!-- docalign:semantic id="C34" claim="Tasks are scoped to the authenticated user" -->
Tasks are scoped to the authenticated user — each request only operates on tasks that belong to the caller.
<!-- /docalign:semantic -->

---

## Endpoints

### GET /api/v1/tasks

<!-- docalign:check type="api_route" -->
`GET /api/v1/tasks` — Returns a paginated list of tasks belonging to the authenticated user.
<!-- /docalign:check -->

**Query parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `page` | number | `1` | Page number (1-indexed) |
| `pageSize` | number | `20` | Results per page (max 100) |
| `status` | string | — | Filter by status: `pending`, `in_progress`, `done` |

<!-- docalign:skip reason="example_response" -->
**Response:**

Example response:
```json
{
  "data": [
    {
      "id": "t_01",
      "title": "Write documentation",
      "status": "in_progress",
      "assigneeId": "u_01",
      "createdAt": "2024-03-10T09:00:00Z"
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 20
}
```
<!-- /docalign:skip -->

---

### POST /api/v1/tasks

<!-- docalign:check type="api_route" -->
`POST /api/v1/tasks` — Creates a new task assigned to the authenticated user by default.
<!-- /docalign:check -->

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | string | Yes | Task title (max 255 characters) |
| `assigneeId` | string | No | ID of the user to assign; defaults to the authenticated user |

<!-- docalign:skip reason="example_curl_and_response" -->
Example request:
```bash
curl -X POST http://localhost:3000/api/v1/tasks \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"title":"Fix the login bug"}'
```

Example response:
```json
{ "id": "t_02", "title": "Fix the login bug", "status": "pending", "assigneeId": "u_01", "createdAt": "2024-03-11T08:00:00Z" }
```
<!-- /docalign:skip -->

Returns `201 Created` on success.

---

### PATCH /api/v1/tasks/:id

<!-- docalign:check type="api_route" -->
`PATCH /api/v1/tasks/:id` — Updates a task's title, status, or assignee. Only the task owner may update their own tasks.
<!-- /docalign:check -->

**Path parameters:**

| Parameter | Description |
|---|---|
| `:id` | The task's unique identifier |

**Request body:** All fields are optional.

| Field | Type | Description |
|---|---|---|
| `title` | string | New task title |
| `status` | string | New status: `pending`, `in_progress`, `done` |
| `assigneeId` | string | ID of the new assignee |

Setting `status` to `done` triggers the `task.completed` event, which the `NotificationService` handles.

---

### DELETE /api/v1/tasks/:id

<!-- docalign:check type="api_route" -->
`DELETE /api/v1/tasks/:id` — Deletes a task permanently. Returns `204 No Content` on success.
<!-- /docalign:check -->

**Path parameters:**

| Parameter | Description |
|---|---|
| `:id` | The task's unique identifier |

---

## Task Object Shape

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique task identifier |
| `title` | string | Task title |
| `status` | string | Current status: `pending`, `in_progress`, or `done` |
| `assigneeId` | string | ID of the assigned user |
| `createdAt` | string | ISO 8601 creation timestamp |
| `updatedAt` | string | ISO 8601 last-updated timestamp |

<!-- docalign:skip reason="example_task_object" -->
Example task object with placeholder data:
```json
{
  "id": "t_99",
  "title": "Sample task",
  "status": "pending",
  "assigneeId": "u_01",
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-01T00:00:00Z"
}
```
<!-- /docalign:skip -->
