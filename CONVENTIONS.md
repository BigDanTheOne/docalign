---
title: "DocAlign Coding Conventions"
summary: "Coding standards for the DocAlign TypeScript codebase covering strict mode, naming, error handling, testing, and linting."
description: "Reference for contributors covering TypeScript conventions (strict mode, no any, const over let), naming rules (kebab-case files, PascalCase types, camelCase functions), error handling patterns, testing requirements (Vitest, AAA), and lint commands."
category: reference
read_when:
  - You are contributing code to DocAlign
  - You are reviewing a PR and need to check naming or style
  - You are setting up lint or test tooling
related:
  - docs/contributing/architecture.md
  - docs/contributing/design-patterns.md
  - docs/contributing/testing.md
docalign:
  setup_date: "2026-02-18T00:00:00Z"
  monitored: true
---

# DocAlign Coding Conventions

## TypeScript

<!-- docalign:semantic id="semantic-strict-mode" claim="strict: true in tsconfig. All types must be explicit at boundaries." -->
- **Strict mode**: `strict: true` in tsconfig. All types must be explicit at boundaries.
- **No `any`**: Use `unknown` and narrow with type guards. For untyped data use `Record<string, unknown>`.
- **Unused variables**: Prefix with `_` if structural (destructuring, callback signatures). Otherwise remove.
- **`const` over `let`**: Use `const` unless the variable is reassigned.
- **No `var`**: Never use `var`.
<!-- docalign:semantic id="semantic-es-imports" claim="Use import/export, not require()" -->
- **ES imports**: Use `import`/`export`, not `require()`.
- **Arrow functions**: Prefer for callbacks. Never use `const self = this`.

## Naming

- Files: kebab-case (`claim-extractor.ts`)
- Types/interfaces: PascalCase (`ClaimRow`)
- Functions/variables: camelCase (`extractClaims`)
- Constants: UPPER_SNAKE_CASE for true constants (`MAX_RETRY_COUNT`), camelCase for config objects
- Test files: mirror source path (`src/layers/L0/parser.ts` -> `test/layers/L0/parser.test.ts`)

## Error Handling

<!-- docalign:semantic id="semantic-error-codes-types" claim="Use typed error codes from src/shared/types.ts" -->
- Use typed error codes from `src/shared/types.ts`
<!-- docalign:semantic id="semantic-pino-logger" claim="Log with Pino (import logger from '../shared/logger')" -->
- Log with Pino (`import logger from '../shared/logger'`)
<!-- docalign:semantic id="semantic-zod-validation" claim="Validate inputs with Zod schemas at boundaries" -->
- Validate inputs with Zod schemas at boundaries
- Never swallow errors silently

## Testing

<!-- docalign:semantic id="semantic-vitest-framework" claim="Testing framework: Vitest" -->
- Framework: Vitest
- Pattern: Arrange-Act-Assert
- After any code change: `npm run typecheck && npm run test`
- After any file edit: `npm run lint:fix`

## Lint

- Run `npm run lint:agent` for errors with remediation instructions
- Run `npm run lint:fix` to auto-fix what can be fixed
<!-- docalign:semantic id="semantic-lint-remediation-json" claim="scripts/lint-remediation.json contains the full rule-to-fix mapping" -->
- See `scripts/lint-remediation.json` for the full rule-to-fix mapping
