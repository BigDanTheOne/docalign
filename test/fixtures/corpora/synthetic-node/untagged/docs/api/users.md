# Users API

The Users API provides endpoints for creating and managing user accounts. All endpoints require authentication unless noted.

---

## Endpoints

### GET /api/v1/users

Returns a paginated list of users.

**Query parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `page` | number | `1` | Page number (1-indexed) |
| `pageSize` | number | `20` | Results per page (max 100) |
| `q` | string | — | Optional search term (matches name and email) |

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

---

### GET /api/v1/users/:id

Returns a single user by ID.

**Path parameters:**

| Parameter | Description |
|---|---|
| `:id` | The user's unique identifier |

**Response:**

Example response:
```json
{ "id": "u_01", "name": "John", "email": "john@example.com", "createdAt": "2024-01-15T10:00:00Z" }
```

Returns `404 Not Found` if the user does not exist.

---

### POST /api/v1/users

Creates a new user. On success, the endpoint returns `201 Created` with the full user object in the response body.

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Display name |
| `email` | string | Yes | Unique email address |
| `password` | string | Yes | Plaintext password (hashed server-side with bcrypt) |

Example request:
```bash
curl -X POST http://localhost:3000/api/v1/users \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice","email":"alice@example.com","password":"secret"}'
```

**Response (201 Created):**

Example response:
```json
{ "id": "u_02", "name": "Alice", "email": "alice@example.com", "createdAt": "2024-03-10T09:00:00Z" }
```

---

### PATCH /api/v1/users/:id

Updates a user's name or email. Only the authenticated user may update their own account.

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

Deletes a user account. This action is irreversible and also deletes all tasks owned by the user.

**Path parameters:**

| Parameter | Description |
|---|---|
| `:id` | The user's unique identifier |

Returns `204 No Content` on success.

---

## The createUser Function

User creation is handled by the `UserService`. The relevant function signature is:

```typescript
createUser({ name, email })
```

This function validates the input, hashes the password with bcrypt (cost factor 12), and inserts the new record. It throws a `ConflictError` if the email address is already registered.

The function is called internally by the `POST /api/v1/users` route handler and is also available for direct use in server-side scripts.
