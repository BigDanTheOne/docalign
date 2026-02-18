# Getting Started

This guide walks you through setting up a local development environment for Taskflow API.

## Prerequisites

Node.js 18 or higher is required. Install it from [nodejs.org](https://nodejs.org) or via a version manager such as `nvm` or `fnm`.

You will also need a running PostgreSQL instance. Docker is the easiest way to get one; see the deployment guide for a one-command setup.

## Installation

Clone the repository: `git clone https://github.com/example/taskflow-api.git`

Change into the project directory and install dependencies:

```bash
npm install
```

## Environment Setup

The project reads all configuration from environment variables. A template is provided — copy it to `.env` and fill in your values before starting the server.

Environment template file: `.env.example`

Copy `.env.example` to `.env` and update the values for your local environment.

At minimum, `DATABASE_URL` and `JWT_SECRET` are required. The other variables have defaults that work for local development. See `docs/guides/configuration.md` for the full reference.

## Building

Compile TypeScript to JavaScript with:

```bash
npm run build
```

This runs `tsc` and writes compiled output to `dist/`. You only need to build explicitly when preparing a production deployment; during development, use the dev server below.

## Starting the Development Server

```bash
npm run dev
```

This starts the server with `tsx watch`, which recompiles and restarts automatically on file changes. The server listens on port 3000 by default.

Open `http://localhost:3000/api/v1` in your browser or HTTP client to verify the server is running. A `404` response from that path is expected — it means the server is up and routing is active.

## Verifying the Setup

Send a request to the health endpoint:

```bash
curl http://localhost:3000/api/v1/users
```

Without a valid JWT token you will receive `401 Unauthorized`, which confirms authentication is working.

## Next Steps

- Read `docs/guides/configuration.md` for all environment variable options.
- Read `docs/guides/deployment.md` to prepare a production deployment.
- Read `docs/api/overview.md` to understand the API surface.
