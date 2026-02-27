# Basic Scan Example

A minimal project showing how DocAlign detects documentation drift.

## Contents

- `api.md` — Sample documentation with claims about the source code
- `src/auth.ts` — Sample source file referenced by the documentation

## Usage

```bash
cd examples/basic-scan
npx docalign check api.md
```

DocAlign will parse `api.md`, extract claims (file paths, function names,
behavioral assertions), and verify each one against the actual source files.

## What to Expect

The sample doc intentionally contains a drifted claim so you can see
what a DocAlign report looks like when documentation is out of sync.
