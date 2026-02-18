# Error Reference

All errors in the Taskflow API follow a consistent response format. This document describes the error shape and lists the common error codes.

---

## Error Response Format

Every error response uses this shape:

```typescript
{ code: string, message: string, details?: unknown }
```

The `code` field is a machine-readable string constant. The `message` field is a human-readable description. The optional `details` field carries additional structured information — for example, a validation error includes the list of failing fields in `details`.

All error handling is centralised in `src/middleware/errorHandler.ts`. Route handlers and services throw typed errors; the error handler middleware converts them to this response shape.

---

## Error Code Reference

The following table lists common error codes. It is illustrative — the entries show example messages and are not exhaustive. See the source code for the complete list.

| HTTP Status | Code | Message |
|---|---|---|
| 400 | `VALIDATION_ERROR` | "Invalid request body" |
| 401 | `UNAUTHORIZED` | "Missing or invalid token" |
| 403 | `FORBIDDEN` | "You do not have permission to perform this action" |
| 404 | `USER_NOT_FOUND` | "User with id X was not found" |
| 404 | `TASK_NOT_FOUND` | "Task with id X was not found" |
| 409 | `CONFLICT` | "A user with that email already exists" |
| 429 | `RATE_LIMITED` | "Too many requests — please wait before retrying" |
| 500 | `SERVER_ERROR` | "An unexpected error occurred" |

These messages are examples only — the actual messages in server responses may differ. Do not assert on message text in integration tests; assert on the `code` field instead.

---

## Validation Errors

When a request body fails Zod schema validation, the server responds with `400 VALIDATION_ERROR`. The `details` field contains the Zod error structure:

```json
{
  "code": "VALIDATION_ERROR",
  "message": "Invalid request body",
  "details": {
    "issues": [
      { "path": ["email"], "message": "Invalid email address" }
    ]
  }
}
```

---

## Notes for Client Developers

- Always check `code`, not `message`. Message text may change between minor versions.
- `details` is present only when the server has additional structured information to convey.
- `5xx` errors indicate a server-side problem. Retry with exponential backoff.
- `401` means the token is missing or invalid. Re-authenticate and retry.
- `429` means the rate limit was hit. Check the `Retry-After` header.
