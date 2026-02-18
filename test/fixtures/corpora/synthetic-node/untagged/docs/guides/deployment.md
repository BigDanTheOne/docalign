# Deployment

This guide covers deploying Taskflow API in a production environment.

## Prerequisites

Node.js 18 or higher must be installed on the target host.

Docker 24.0 or higher is required if you are using the Docker Compose workflow described below.

## Starting the Database

The project ships with a `docker-compose.yml` that starts a PostgreSQL instance with the correct database name and user credentials:

```bash
docker compose up -d
```

This starts PostgreSQL in the background. The database will be available at `localhost:5432`. Use the connection string from your `.env` file to verify connectivity.

Example environment configuration for a production deployment:

```
DATABASE_URL=postgres://taskflow:s3cr3t@db.internal:5432/taskflow_prod
JWT_SECRET=<generate with: openssl rand -base64 48>
PORT=3000
RATE_LIMIT_MAX=100
```

Replace all placeholder values before deploying.

## Running Migrations

After the database is up, apply all pending migrations:

```bash
npm run migrate
```

This runs `node-pg-migrate up` against the `DATABASE_URL` in your environment. Run this command on every deployment that includes schema changes. Migrations are idempotent; running them on an already-migrated database is safe.

## Building for Production

Compile the TypeScript source:

```bash
npm run build
```

Build output directory: `dist/`

The entry point is `dist/index.js`. All files in `dist/` are plain JavaScript with no TypeScript dependency at runtime.

The `dist/` directory should not be committed to version control. It is regenerated on every deployment from the source in `src/`.

## Starting the Server

After building, start the server with:

```bash
node dist/index.js
```

In production, run this under a process manager such as systemd or PM2 to ensure automatic restarts on failure.

## Health Check

The server does not expose a dedicated health endpoint in the current version. Use a shallow GET request to any authenticated endpoint and check for a `401` response to confirm the server is running and routing correctly.

## Docker Deployment

A minimal Dockerfile is not included in this release but can be constructed from the following stages: install production dependencies, run `npm run build`, copy `dist/` and `node_modules/` into a `node:18-alpine` image, and set the entrypoint to `node dist/index.js`.
