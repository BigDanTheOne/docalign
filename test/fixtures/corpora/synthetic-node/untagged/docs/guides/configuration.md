# Configuration

Taskflow API is configured entirely through environment variables. All env var access is consolidated in the central configuration module — no variables are read outside of it.

Central config module: `src/config/index.ts`

## Quick Setup

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Then fill in the required values.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | (required) | PostgreSQL connection string |
| `JWT_SECRET` | (required) | Secret key used to sign and verify JWT tokens |
| `PORT` | `3000` | HTTP port the server listens on |
| `RATE_LIMIT_MAX` | `100` | Maximum requests per IP per 15-minute window |

All env vars have documented defaults except `DATABASE_URL` and `JWT_SECRET`, which are required and have no fallback. The server will exit at startup if either is missing.

## Variable Reference

### DATABASE_URL

PostgreSQL connection string. Required. No default.

Example value: `postgres://user:pass@localhost/taskflow`

The value is passed directly to the `pg` client pool. Ensure the database exists and the user has sufficient privileges before starting the server.

### JWT_SECRET

Secret key for JWT signing. Required. No default.

Use a randomly generated string of at least 32 characters. In production, set this from a secrets manager rather than a `.env` file.

### PORT

The HTTP port the server binds to. Defaults to `3000`.

In containerised deployments, leave `PORT` at its default and configure the container's port mapping instead.

### RATE_LIMIT_MAX

Maximum number of requests allowed per IP address per 15-minute window. Defaults to `100`.

Adjust this value based on your expected traffic patterns. Setting it too low will result in legitimate clients receiving `429 Too Many Requests` responses.

## Config Module

All configuration is exported from `src/config/index.ts`:

```typescript
import { config } from './config';

const port = config.PORT;          // number
const dbUrl = config.DATABASE_URL; // string
```

Importing env vars directly from `process.env` outside of this module is a lint error. Centralising config in one module makes it easier to audit what the server depends on and to mock values in tests.
