# API Authentication

## Overview

All API requests must include a valid JWT token in the `Authorization` header.
Tokens are validated by the `validateToken` function in `src/auth.ts`.

## Endpoints

### `POST /api/login`

Accepts `{ email, password }` and returns a signed JWT token.

### `GET /api/profile`

Returns the authenticated user's profile. Requires a valid token.

## Error Handling

Invalid tokens return a `401 Unauthorized` response with a JSON body:

```json
{ "error": "Invalid or expired token" }
```
