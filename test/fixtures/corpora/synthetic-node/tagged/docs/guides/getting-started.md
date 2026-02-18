# Getting Started

This guide walks you through setting up a local development environment for Taskflow API.

## Prerequisites

<!-- docalign:skip reason="prerequisite_version" -->
Node.js 18 or higher is required. Install it from [nodejs.org](https://nodejs.org) or via a version manager such as `nvm` or `fnm`.
<!-- /docalign:skip -->

You will also need a running PostgreSQL instance. Docker is the easiest way to get one; see the deployment guide for a one-command setup.

## Installation

<!-- docalign:skip reason="installation_instruction" -->
Clone the repository: `git clone https://github.com/example/taskflow-api.git`

Change into the project directory and install dependencies:

```bash
npm install
```
<!-- /docalign:skip -->

## Environment Setup

The project reads all configuration from environment variables. A template is provided — copy it to `.env` and fill in your values before starting the server.

<!-- docalign:check type="path_reference" -->
Environment template file: `.env.example`
<!-- /docalign:check -->

<!-- docalign:skip reason="installation_instruction" -->
Copy `.env.example` to `.env` and update the values for your local environment.
<!-- /docalign:skip -->

At minimum, `DATABASE_URL` and `JWT_SECRET` are required. The other variables have defaults that work for local development. See `docs/guides/configuration.md` for the full reference.

## Building

Compile TypeScript to JavaScript with:

<!-- docalign:check type="command" -->
```bash
npm run build
```
<!-- /docalign:check -->

This runs `tsc` and writes compiled output to `dist/`. You only need to build explicitly when preparing a production deployment; during development, use the dev server below.

## Starting the Development Server

<!-- docalign:check type="command" -->
```bash
npm run dev
```
<!-- /docalign:check -->

This starts the server with `tsx watch`, which recompiles and restarts automatically on file changes. The server listens on port 3000 by default.

<!-- docalign:skip reason="example_url" -->
Open `http://localhost:3000/api/v1` in your browser or HTTP client to verify the server is running. A `404` response from that path is expected — it means the server is up and routing is active.
<!-- /docalign:skip -->

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
