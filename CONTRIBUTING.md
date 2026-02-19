# Contributing to DocAlign

Thank you for your interest in contributing to DocAlign! This document provides guidelines and best practices for contributing to the project.

## Getting Started

### Prerequisites

- Node.js >= 18.0.0
- PostgreSQL (for server development)
- Redis (for job queue)
- Git

### Development Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/BigDanTheOne/docalign.git
   cd docalign
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start local services:
   ```bash
   docker compose up -d
   ```

4. Run database migrations:
   ```bash
   npm run migrate:up
   ```

5. Run tests to verify setup:
   ```bash
   npm run typecheck && npm run test
   ```

## Development Workflow

### Before Making Changes

1. Create a new branch from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Read relevant specification documents in `phases/` and `tasks/` directories

### While Developing

1. **Follow existing patterns**: Match code style, error handling, and naming conventions
2. **Run linter after edits**:
   ```bash
   npm run lint:fix
   ```

3. **Run type checking and tests frequently**:
   ```bash
   npm run typecheck && npm run test
   ```

4. **Write tests for new functionality**: Tests go in `test/` mirroring `src/` structure

### Code Quality Standards

- TypeScript strict mode must pass (`npm run typecheck`)
- All tests must pass (`npm run test`)
- ESLint must pass with no errors (`npm run lint`)
- New code must have test coverage
- Follow existing patterns in the codebase

### Commit Guidelines

- Use conventional commit format: `type(scope): description`
- Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`
- Keep commits focused and atomic
- Reference issue numbers when applicable

Examples:
```
feat(L3): add Tier 2 verification for file existence claims
fix(L1): respect docalign:skip regions in regex extraction
refactor(L0): optimize AST node lookup performance
test(E2): add integration tests for claim extraction pipeline
docs: update README with new MCP tool examples
chore: bump version to 0.4.0
```

## Version Hygiene

DocAlign follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

### Version Number Format

- **MAJOR.MINOR.PATCH** (e.g., 1.2.3)
- **MAJOR**: Breaking changes to public APIs
- **MINOR**: New features, backward-compatible
- **PATCH**: Bug fixes, backward-compatible

**Pre-1.0 Caveat**: During 0.x.x releases, minor versions may include breaking changes as the API stabilizes.

### When to Bump Versions

| Change Type | Version Bump | Examples |
|-------------|--------------|----------|
| Breaking API change | MAJOR | Remove MCP tool, change config schema incompatibly |
| New feature | MINOR | Add new MCP tool, new CLI command, new verification tier |
| Bug fix | PATCH | Fix false positive, correct claim extraction logic |
| Internal refactor | PATCH | Restructure code without API changes |
| Documentation | PATCH | Update README, fix typos |

### Version Bump Process

1. **Update package.json**:
   ```bash
   # For patch release
   npm version patch

   # For minor release
   npm version minor

   # For major release (1.0.0+)
   npm version major
   ```

2. **Update CHANGELOG.md**:
   - Move unreleased changes to new version section
   - Add release date
   - Add comparison link at bottom
   - Follow [Keep a Changelog](https://keepachangelog.com/) format

3. **Create git tag**:
   ```bash
   git tag v0.x.x
   ```

4. **Commit version bump**:
   ```bash
   git add package.json CHANGELOG.md
   git commit -m "0.x.x"
   ```

5. **Push with tags**:
   ```bash
   git push origin main --tags
   ```

### CHANGELOG Maintenance

Every release must update `CHANGELOG.md`:

- **Added**: New features
- **Changed**: Changes to existing functionality
- **Deprecated**: Soon-to-be-removed features
- **Removed**: Removed features
- **Fixed**: Bug fixes
- **Security**: Security fixes

Example:
```markdown
## [0.4.0] - 2026-02-20

### Added
- New MCP tool `suggest_fix` for automated claim corrections

### Changed
- Improved semantic claim extraction accuracy by 15%

### Fixed
- False positives in file path verification
- Memory leak in AST parser cache
```

### Pre-release Versions

For testing before official release:

```bash
# Alpha
npm version prerelease --preid=alpha
# 0.4.0-alpha.0

# Beta
npm version prerelease --preid=beta
# 0.4.0-beta.0

# Release candidate
npm version prerelease --preid=rc
# 0.4.0-rc.0
```

## Pull Request Process

1. **Ensure all checks pass**:
   ```bash
   npm run typecheck && npm run test && npm run lint
   ```

2. **Update documentation**:
   - Update README.md if adding user-facing features
   - Update CHANGELOG.md with your changes in `[Unreleased]` section
   - Add/update JSDoc comments for public APIs

3. **Create pull request**:
   - Use descriptive title following commit convention
   - Reference related issues
   - Describe what changed and why
   - Include test coverage information

4. **PR review**:
   - Address reviewer feedback
   - Keep commits clean (squash if needed)
   - Ensure CI passes

## Testing

### Test Categories

- **Unit tests**: Test individual functions/modules
- **Integration tests**: Test layer interactions (L0 → L1 → L2)
- **E2E tests**: Test full workflows (webhook → verification → PR comment)
- **QA tests**: Contract/acceptance tests in `test/qa/`

### Running Tests

```bash
# All tests
npm run test

# QA acceptance tests only
npm run test:qa

# Corpus validation tests
npm run test:corpus

# Watch mode
npm run test:watch

# Specific test file
npm run test test/layers/L1-claim-extractor/claim-extractor.test.ts
```

### Writing Tests

- Use Vitest framework
- Co-locate tests with source files or mirror structure in `test/`
- Follow AAA pattern: Arrange, Act, Assert
- Use descriptive test names
- Mock external dependencies (database, GitHub API, etc.)

## Documentation

### Code Documentation

- Add JSDoc comments for exported functions/classes
- Include parameter types, return types, and examples
- Document error conditions and edge cases

### User Documentation

- Update README.md for user-facing changes
- Add examples to demonstrate new features
- Keep installation instructions up-to-date

## Questions?

- Open an issue for bug reports or feature requests
- Check existing issues before creating new ones
- Join discussions in GitHub Discussions (when available)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
