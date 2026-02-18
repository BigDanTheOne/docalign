# Users API

The Users API provides endpoints for creating and managing user accounts. All endpoints require authentication unless noted.

---

## Endpoints

### GET /api/v1/users

<!-- docalign:check type="api_route" -->
`GET /api/v1/users` — Returns a paginated list of users.
<!-- /docalign:check -->

**Query parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `page` | number | `1` | Page number (1-indexed) |
| `pageSize` | number | `20` | Results per page (max 100) |
| `q` | string | — | Optional search term (matches name and email) |

<!-- docalign:skip reason="example_response" -->
**Response:**

```json
{
  "data": [
    { "id": "u_01", "name": "Alice", "email": "alice@example.com", "createdAt": "2024-01-15T10:00:00Z" }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 20
}
```
<!-- /docalign:skip -->

---

### GET /api/v1/users/:id

<!-- docalign:check type="api_route" -->
`GET /api/v1/users/:id` — Returns a single user by ID.
<!-- /docalign:check -->

**Path parameters:**

| Parameter | Description |
|---|---|
| `:id` | The user's unique identifier |

<!-- docalign:skip reason="example_response" -->
**Response:**

Example response:
```json
{ "id": "u_01", "name": "John", "email": "john@example.com", "createdAt": "2024-01-15T10:00:00Z" }
```
<!-- /docalign:skip -->

Returns `404 Not Found` if the user does not exist.

---

### POST /api/v1/users

<!-- docalign:check type="api_route" -->
`POST /api/v1/users` — Creates a new user.
<!-- /docalign:check -->

<!-- docalign:semantic id="C28" claim="POST /api/v1/users returns 201 Created with user object" -->
On success, the endpoint returns `201 Created` with the full user object in the response body.
<!-- /docalign:semantic -->

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Display name |
| `email` | string | Yes | Unique email address |
| `password` | string | Yes | Plaintext password (hashed server-side with bcrypt) |

<!-- docalign:skip reason="example_curl" -->
Example request:
```bash
curl -X POST http://localhost:3000/api/v1/users \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@example.com","password":"secret"}'
```
<!-- /docalign:skip -->

<!-- docalign:skip reason="example_response" -->
**Response (201 Created):**

Example response:
```json
{ "id": "u_02", "name": "Alice", "email": "alice@example.com", "createdAt": "2024-03-10T09:00:00Z" }
```
<!-- /docalign:skip -->

---

### PATCH /api/v1/users/:id

<!-- docalign:check type="api_route" -->
`PATCH /api/v1/users/:id` — Updates a user's name or email. Only the authenticated user may update their own account.
<!-- /docalign:check -->

**Path parameters:**

| Parameter | Description |
|---|---|
| `:id` | The user's unique identifier |

**Request body:** All fields are optional. Supply only the fields to update.

| Field | Type | Description |
|---|---|---|
| `name` | string | New display name |
| `email` | string | New email address |

---

### DELETE /api/v1/users/:id

<!-- docalign:check type="api_route" -->
`DELETE /api/v1/users/:id` — Deletes a user account. This action is irreversible and also deletes all tasks owned by the user.
<!-- /docalign:check -->

**Path parameters:**

| Parameter | Description |
|---|---|
| `:id` | The user's unique identifier |

Returns `204 No Content` on success.

---

## The createUser Function

User creation is handled by the `UserService`. The relevant function signature is:

<!-- docalign:check type="code_example" -->
`createUser({ name, email, password })` — hashes the password with bcrypt and inserts the user record.
<!-- /docalign:check -->

This function validates the input, hashes the password with bcrypt (cost factor 12), and inserts the new record. It throws a `ConflictError` if the email address is already registered.

The function is called internally by the `POST /api/v1/users` route handler and is also available for direct use in server-side scripts.
