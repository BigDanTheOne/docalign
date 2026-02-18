# DocAlign Coding Conventions

## TypeScript

- **Strict mode**: `strict: true` in tsconfig. All types must be explicit at boundaries.
- **No `any`**: Use `unknown` and narrow with type guards. For untyped data use `Record<string, unknown>`.
- **Unused variables**: Prefix with `_` if structural (destructuring, callback signatures). Otherwise remove.
- **`const` over `let`**: Use `const` unless the variable is reassigned.
- **No `var`**: Never use `var`.
- **ES imports**: Use `import`/`export`, not `require()`.
- **Arrow functions**: Prefer for callbacks. Never use `const self = this`.

## Naming

- Files: kebab-case (`claim-extractor.ts`)
- Types/interfaces: PascalCase (`ClaimRow`)
- Functions/variables: camelCase (`extractClaims`)
- Constants: UPPER_SNAKE_CASE for true constants (`MAX_RETRY_COUNT`), camelCase for config objects
- Test files: mirror source path (`src/layers/L0/parser.ts` -> `test/layers/L0/parser.test.ts`)

## Error Handling

- Use typed error codes from `src/shared/types.ts`
- Log with Pino (`import logger from '../shared/logger'`)
- Validate inputs with Zod schemas at boundaries
- Never swallow errors silently

## Testing

- Framework: Vitest
- Pattern: Arrange-Act-Assert
- After any code change: `npm run typecheck && npm run test`
- After any file edit: `npm run lint:fix`

## Lint

- Run `npm run lint:agent` for errors with remediation instructions
- Run `npm run lint:fix` to auto-fix what can be fixed
- See `scripts/lint-remediation.json` for the full rule-to-fix mapping
