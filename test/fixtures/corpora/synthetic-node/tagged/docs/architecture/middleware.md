# Middleware Reference

This document describes each middleware layer in the Taskflow API, its configuration, and its contract with the rest of the application.

---

## Logger

<!-- docalign:check type="dep_version" -->
The logger middleware is implemented with `pino 8.15.0`, a high-throughput structured JSON logger. It is the first middleware registered in the application.
<!-- /docalign:check -->

<!-- docalign:semantic id="C41" claim="Logger middleware attaches requestId and duration to every log line" -->
For every request, the logger middleware generates a UUID and attaches it as `requestId` to the log context. It also measures elapsed time and attaches `duration` (in milliseconds) to the final log line, which is written after the response is sent.
<!-- /docalign:semantic -->

<!-- docalign:skip reason="illustrative_trace" -->
A typical request trace looks like: the logger captures the incoming request, wraps the response stream, and on `finish` writes a single JSON log entry containing the method, URL, status code, requestId, and duration.
<!-- /docalign:skip -->

<!-- docalign:skip reason="example_log_output" -->
Example log output:
```json
{ "level": "info", "requestId": "abc-123", "method": "GET", "url": "/api/v1/users", "statusCode": 200, "duration": 12, "msg": "GET /api/v1/users 200 12ms" }
```
<!-- /docalign:skip -->

This log shape is stable — downstream log aggregation and alerting depends on the presence of `requestId` and `duration` fields.

---

## Auth

<!-- docalign:semantic id="C42" claim="Auth middleware attaches decoded payload to req.user" -->
The auth middleware validates JWT bearer tokens. It reads the `Authorization` header, extracts the token, and verifies it with the `JWT_SECRET` from the environment.

On a valid token, the auth middleware attaches the decoded payload to `req.user`. Route handlers and service methods downstream can then access the authenticated user's ID and email without re-parsing the token.
<!-- /docalign:semantic -->

On a missing or invalid token, the middleware immediately responds with `401 Unauthorized` and does not call `next()`. The route handler is never reached.

Tokens expire after 24 hours. The `signToken` utility in `src/middleware/auth.ts` issues tokens with `expiresIn: '24h'`.

---

## RateLimit

Rate limiting is implemented with `express-rate-limit`. The configuration is:

- Window: 15 minutes (`15 * 60 * 1000` milliseconds)
- Maximum requests per window: 100
- Key: client IP address

When the limit is exceeded, the middleware responds with `429 Too Many Requests`. The `Retry-After` header is included in the response.

The maximum can be overridden via the `RATE_LIMIT_MAX` environment variable. This is useful in staging environments where higher limits are needed for load testing.

---

## ErrorHandler

<!-- docalign:semantic id="C43" claim="ErrorHandler is registered last — catches all unhandled errors" -->
The error handler is registered last — it catches all unhandled errors thrown by route handlers or other middleware layers. It converts typed application errors to the standard `{ code, message, details? }` response shape and logs the error with its stack trace.
<!-- /docalign:semantic -->

Because it is registered after all routes, Express passes it four-argument errors (`err, req, res, next`), which is how Express distinguishes error handlers from regular middleware.

The error handler never calls `next()`. Every code path through the handler sends a response and ends the request-response cycle.

<!-- docalign:skip -->
See [Error Reference](../api/errors.md) for the full error code list.
<!-- /docalign:skip -->
