# API Overview

The Taskflow API is a REST API for task management. This document describes the conventions, authentication model, and constraints that apply to every endpoint.

---

## Base URL

All endpoints are prefixed with `/api/v1`. There is no versioning suffix beyond this prefix — the `v1` segment is considered stable for the lifetime of this major version.

For local development, the full base URL is `http://localhost:3000/api/v1`.

Try it out with curl: `curl http://localhost:3000/api/v1/users`

---

## Content Type

All responses are `application/json`. The server sets the `Content-Type: application/json` response header on every endpoint, including error responses. Requests that include a body (POST, PATCH) must also send `Content-Type: application/json`.

---

## Authentication

The API uses JWT bearer tokens for authentication. Include the token in the `Authorization` header:

```
Authorization: Bearer <your-token>
```

Unauthenticated requests receive `401 Unauthorized`. This applies to all endpoints except the health check at `GET /api/v1/health`, which is public.

The token is issued by `POST /api/v1/auth/login` and expires after 24 hours.

---

## Rate Limiting

To protect the service from abuse, the API enforces a rate limit of 100 requests per 15 minutes per IP address. When the limit is exceeded, the server responds with `429 Too Many Requests` and includes a `Retry-After` header indicating when the limit resets.

The rate limit window is sliding — it resets 15 minutes after the first request in the current window, not at a fixed clock boundary.

---

## Pagination

List endpoints return paginated results. The response envelope includes:

| Field | Type | Description |
|---|---|---|
| `data` | array | The page of results |
| `total` | number | Total count of matching records |
| `page` | number | Current page (1-indexed) |
| `pageSize` | number | Number of results per page |

Query parameters `page` and `pageSize` control pagination. Defaults: `page=1`, `pageSize=20`.

---

## Error Handling

All errors follow a consistent shape. See [Error Reference](./errors.md) for the full error code list and the error response format.
