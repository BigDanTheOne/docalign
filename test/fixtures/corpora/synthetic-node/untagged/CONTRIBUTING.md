# Contributing to Taskflow API

Thank you for your interest in contributing. This document describes the process for submitting changes to the project.

## Getting Started

Fork the repository on GitHub, then clone your fork locally and create a new branch for your change.

## Development Workflow

Install dependencies with `npm install`, then make your changes in a feature branch.

Before opening a pull request, run the full verification suite:

```bash
npm test
npm run lint
npm run typecheck
```

All three commands must pass with no errors or warnings before a PR will be reviewed.

## Running the Test Suite

```bash
npm test
```

Tests are written with Vitest and live in the `test/` directory, mirroring the `src/` structure. Integration tests require a running PostgreSQL instance; see `docs/guides/getting-started.md` for setup instructions.

## Linting

```bash
npm run lint
```

The project uses ESLint with the TypeScript plugin. Configuration is in `.eslintrc.json`. Lint errors will cause CI to fail.

## Type Checking

```bash
npm run typecheck
```

TypeScript is configured in strict mode. All types must be explicit — avoid `any`. The typecheck script runs `tsc --noEmit` against the full `src/` tree.

## Commit Messages

Commits follow the Conventional Commits format. Examples:

```
feat(users): add email verification
fix(auth): handle expired token edge case
docs(readme): clarify port configuration
```

Keep the subject line under 72 characters. Reference issue numbers in the body where relevant.

## Pull Request Process

1. Ensure all three verification commands pass locally.
2. Update documentation in `docs/` if your change affects public-facing behaviour.
3. Add or update tests for any changed logic.
4. Request a review from a maintainer.

PRs that reduce test coverage or introduce lint errors will not be merged.
