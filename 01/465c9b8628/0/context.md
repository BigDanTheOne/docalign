# Session Context

**Session ID:** 7cb54db1-2bf8-4a64-a016-c7571636212d

**Commit Message:** <task-notification>
<task-id>a5c6edc</task-id>
<status>completed</status

## Prompt

<task-notification>
<task-id>a5c6edc</task-id>
<status>completed</status>
<summary>Agent "Research deterministic doc-code checks" completed</summary>
<result>Now I have comprehensive data across all the tools. Let me compile the full inventory.

---

# Comprehensive Inventory of Deterministic Documentation-Code Alignment Checks

This inventory catalogs every specific deterministic (non-AI, non-LLM) check found across production tools, organized by category and level of analysis.

---

## CATEGORY 1: CODE-TO-DOCSTRING SIGNATURE ALIGNMENT

These checks compare function/method/class documentation against the actual code AST to detect mismatches.

### 1.1 Parameter Name Matching

| Check | Tool | What It Detects | Signal | False Positive Profile | Level |
|-------|------|----------------|--------|----------------------|-------|
| `check-param-names` | eslint-plugin-jsdoc | @param name doesn't match function parameter name | AST param list vs JSDoc @param tags | Low - direct name comparison | Structural |
| `require-param` | eslint-plugin-jsdoc | Function has parameters but @param tags are missing | AST param count vs JSDoc @param count | Low for simple cases; destructured params can cause FPs | Structural |
| DAR101 | darglint | Docstring missing a parameter present in function definition | AST function signature vs parsed docstring | Low | Structural |
| DAR102 | darglint | Docstring documents a parameter not in function | AST function signature vs parsed docstring | Low | Structural |
| PR01 | numpydoc | Parameters in function not documented in docstring | AST inspection + docstring section parsing | Low | Structural |
| PR02 | numpydoc | Unknown parameters documented that are not in function | AST vs docstring section | Low | Structural |
| PR03 | numpydoc | Parameters documented in wrong order vs function signature | AST param order vs docstring order | Medium - order may be intentionally different | Structural |
| D417 | pydocstyle | Missing argument descriptions in docstring | AST param names vs docstring content | Low | Structural |
| `reference` group | Java DocLint | @param references non-existent parameter | AST vs Javadoc @param | Low | Structural |

### 1.2 Return Type/Value Matching

| Check | Tool | What It Detects | Signal | False Positive Profile | Level |
|-------|------|----------------|--------|----------------------|-------|
| `require-returns-check` | eslint-plugin-jsdoc | @returns present but function body has no return statement, or vice versa | AST return statement scan vs JSDoc @returns | Medium - conditional returns, implicit returns | Structural |
| `require-returns` | eslint-plugin-jsdoc | Function with return statement but missing @returns tag | AST body scan for ReturnStatement | Medium - void returns | Structural |
| DAR201 | darglint | Docstring missing return that function actually returns | AST return statement detection | Medium | Structural |
| DAR202 | darglint | Docstring describes return but function has none | AST body scan | Low | Structural |
| RT01 | numpydoc | No Returns section found for function that returns | AST + docstring section | Medium | Structural |

### 1.3 Type Annotation Matching

| Check | Tool | What It Detects | Signal | False Positive Profile | Level |
|-------|------|----------------|--------|----------------------|-------|
| `check-types` | eslint-plugin-jsdoc | Invalid or inconsistent type annotations in JSDoc | JSDoc type expression parsing | Medium - complex union/generic types | Syntax |
| `no-undefined-types` | eslint-plugin-jsdoc | Type referenced in JSDoc that is not defined/imported | JSDoc type vs scope analysis | Medium - third-party types may not be in scope | Structural |
| `valid-types` | eslint-plugin-jsdoc | Malformed type syntax in JSDoc | JSDoc type grammar validation | Low | Syntax |
| DAR103 | darglint | Docstring parameter type doesn't match function type annotation | AST type annotation vs docstring type | Medium - type alias resolution | Structural |
| DAR105 | darglint | Malformed type in docstring parameter | Docstring type parsing | Low | Syntax |
| PR04 | numpydoc | Parameter has no type specified | Docstring section parsing | Low | Structural |
| PR06 | numpydoc | Parameter type uses incorrect format | Regex on type string | Medium | Syntax |

### 1.4 Yield/Generator Documentation

| Check | Tool | What It Detects | Signal | False Positive Profile | Level |
|-------|------|----------------|--------|----------------------|-------|
| `require-yields` | eslint-plugin-jsdoc | Generator function missing @yields tag | AST YieldExpression detection | Low | Structural |
| `require-yields-check` | eslint-plugin-jsdoc | @yields present but no yield in function body | AST body scan | Low | Structural |
| DAR301 | darglint | Missing yield documentation for generator | AST yield detection | Low | Structural |
| DAR302 | darglint | Documents yield but function doesn't yield | AST body scan | Low | Structural |
| YD01 | numpydoc | No Yields section for generator function | AST + docstring | Low | Structural |

### 1.5 Exception/Throws Documentation

| Check | Tool | What It Detects | Signal | False Positive Profile | Level |
|-------|------|----------------|--------|----------------------|-------|
| `require-throws` | eslint-plugin-jsdoc | Function throws but missing @throws tag | AST ThrowStatement detection | High - re-thrown exceptions, conditional throws | Structural |
| DAR401 | darglint | Docstring missing an exception that function raises | AST raise statement detection | High - conditional, transitive raises | Structural |
| DAR402 | darglint | Docstring describes exception not explicitly raised | AST body scan | Medium | Structural |

### 1.6 Template/Generic Documentation

| Check | Tool | What It Detects | Signal | False Positive Profile | Level |
|-------|------|----------------|--------|----------------------|-------|
| `check-template-names` | eslint-plugin-jsdoc | @template name doesn't match TypeScript generic parameter | AST TypeParameter vs JSDoc @template | Low | Structural |
| `require-template` | eslint-plugin-jsdoc | Generic function missing @template tags | AST generic params vs JSDoc | Low | Structural |

### 1.7 Property Documentation

| Check | Tool | What It Detects | Signal | False Positive Profile | Level |
|-------|------|----------------|--------|----------------------|-------|
| `check-property-names` | eslint-plugin-jsdoc | @property name mismatch with actual object/type properties | AST property analysis vs JSDoc | Medium | Structural |
| `require-property` | eslint-plugin-jsdoc | Type/object missing @property documentation | AST vs JSDoc | Medium | Structural |

---

## CATEGORY 2: DOCUMENTATION PRESENCE/COVERAGE

These checks verify that code entities have documentation at all.

### 2.1 Missing Documentation Detection

| Check | Tool | What It Detects | Signal | False Positive Profile | Level |
|-------|------|----------------|--------|----------------------|-------|
| `require-jsdoc` | eslint-plugin-jsdoc | Function/class/method has no JSDoc comment block | AST node type check + comment association | Low - configurable what requires docs | Structural |
| `missing_docs` (rustdoc) | rustdoc | Public item has no doc comment | Compiler item visibility + comment presence | Low | Structural |
| `missing_crate_level_docs` | rustdoc | Crate root has no documentation | Root module doc comment check | Low | Structural |
| `missing_doc_code_examples` | rustdoc | Doc block has no code example | Doc comment content analysis | Medium - not all items need examples | Structural |
| C0114 | pylint | Missing module docstring | AST Module node docstring check | Low | Structural |
| C0115 | pylint | Missing class docstring | AST ClassDef node docstring check | Low | Structural |
| C0116 | pylint | Missing function/method docstring | AST FunctionDef node docstring check | Low | Structural |
| D100-D107 | pydocstyle | Missing docstrings at module/class/method/function/package/magic/__init__ level | AST node type + docstring presence | Low - configurable | Structural |
| GL08 | numpydoc | Object has no docstring at all | AST inspection | Low | Structural |
| `validation.notDocumented` | TypeDoc | Exported TypeScript symbol has no documentation | TS AST exported symbols vs doc comments | Medium - some symbols intentionally undocumented | Structural |
| `validation.notExported` | TypeDoc | Type referenced in docs but not exported | TS AST export analysis | Low | Structural |
| `accessibility` group | Java DocLint | Missing alt on images, missing caption/summary on tables in Javadoc | HTML parsing within Javadoc | Low | Syntax |
| `missing` group | Java DocLint | Undocumented parameters, missing return docs | AST vs Javadoc tag comparison | Low | Structural |
| `Undocumented Symbols` | DocSync | New functions/classes extracted from AST that have no documentation | Tree-sitter AST extraction vs doc search | Medium - may flag intentionally undocumented internals | Structural |

### 2.2 Coverage Metrics

| Check | Tool | What It Detects | Signal | False Positive Profile | Level |
|-------|------|----------------|--------|----------------------|-------|
| Coverage % | interrogate (Python) | Percentage of functions/classes/modules/methods with docstrings | AST Module/ClassDef/FunctionDef/AsyncFunctionDef visitor | Low - pure counting | Structural |
| `--fail-under` threshold | interrogate | Coverage below configurable percentage | Aggregate count vs threshold | Low | Structural |
| Coverage report | docstr-coverage | Per-file and project-wide docstring coverage stats | AST visitor counting | Low | Structural |

---

## CATEGORY 3: LINK AND REFERENCE VALIDATION

### 3.1 Internal Documentation Links

| Check | Tool | What It Detects | Signal | False Positive Profile | Level |
|-------|------|----------------|--------|----------------------|-------|
| `broken_intra_doc_links` | rustdoc | Doc link to type/function/module that doesn't exist or is ambiguous | Compiler name resolution on doc link paths | Low - compiler-grade resolution | Structural |
| `private_intra_doc_links` | rustdoc | Public item doc links to private item | Visibility analysis on link target | Low | Structural |
| MD051 | markdownlint | Link fragment doesn't reference a valid heading in the file | Heading ID generation + fragment matching | Low | Structural |
| MD052 | markdownlint | Reference link/image uses label that is not defined | Reference definition lookup | Low | Structural |
| MD053 | markdownlint | Reference definition exists but is never used | Reference usage scan | Low | Structural |
| `validation.invalidLink` | TypeDoc | @link tag cannot be resolved to a symbol | TS symbol resolution | Medium - external references | Structural |
| `validation.invalidPath` | TypeDoc | Link to relative path that doesn't exist as a file | File existence check | Low | Structural |
| `validation.rewrittenLink` | TypeDoc | @link resolved but target has no unique URL | URL generation analysis | Medium | Structural |
| `no-undefined-references` | remark-lint | Markdown reference links that have no corresponding definition | AST reference node vs definition scan | Low | Structural |
| `reference` group | Java DocLint | @see tag references non-existent type, @param references non-existent parameter | Compiler symbol resolution | Low | Structural |
| Broken internal links | Mintlify | Documentation internal links point to pages that don't exist | Path/route matching | Low | Structural |
| Internal link check | remark-validate-links | Local file/heading links in Git repo that don't resolve | Git repo file scan + heading extraction | Low | Structural |

### 3.2 External URL Validation

| Check | Tool | What It Detects | Signal | False Positive Profile | Level |
|-------|------|----------------|--------|----------------------|-------|
| HTTP link check | markdown-link-check | External URLs return non-200 status (dead links) | HTTP HEAD/GET request | High - temporary outages, rate limiting, geo-blocking | Behavioral |
| `no-dead-urls` | remark-lint | External URLs that are unreachable | HTTP request | High - same as above | Behavioral |
| MD034 | markdownlint | Bare URLs not formatted as links | Regex URL detection | Low | Syntax |
| `bare_urls` | rustdoc | URLs in docs not formatted as proper links | URL pattern detection in doc text | Low | Syntax |

---

## CATEGORY 4: DOCUMENTATION SYNTAX AND STRUCTURE

### 4.1 Doc Comment Syntax Validation

| Check | Tool | What It Detects | Signal | False Positive Profile | Level |
|-------|------|----------------|--------|----------------------|-------|
| `check-syntax` | eslint-plugin-jsdoc | Invalid JSDoc syntax (e.g., Closure syntax in non-Closure mode) | JSDoc parser | Low | Syntax |
| `check-tag-names` | eslint-plugin-jsdoc | Unrecognized JSDoc tag names (e.g., @paramm instead of @param) | Tag name lookup against known tags | Low | Syntax |
| `check-access` | eslint-plugin-jsdoc | Invalid @access tag values | Tag value validation | Low | Syntax |
| `check-values` | eslint-plugin-jsdoc | Invalid values for @version, @since, @license, etc. | Regex/format validation | Low | Syntax |
| `invalid_codeblock_attributes` | rustdoc | Mis-typed code block attributes (e.g., `should-panic` instead of `should_panic`) | Attribute name matching against known attributes | Low | Syntax |
| `invalid_html_tags` | rustdoc | Unclosed or invalid HTML tags in doc comments | HTML parser | Low | Syntax |
| `invalid_rust_codeblocks` | rustdoc | Rust code in doc examples with unparseable syntax | Rust parser on code block content | Medium - incomplete examples | Syntax |
| `syntax` group | Java DocLint | Unescaped `<` characters, unmatched braces in `{@foo}` | Character/bracket scanning | Low | Syntax |
| `html` group | Java DocLint | Invalid HTML tags/attributes, unclosed tags, block in inline | HTML 4/5 specification rules | Medium - intentional raw HTML | Syntax |
| `tsdoc/syntax` | eslint-plugin-tsdoc | TSDoc comment doesn't conform to TSDoc specification | TSDoc parser | Low | Syntax |
| `tsdoc-param-tag-missing-hyphen` | eslint-plugin-tsdoc | @param block missing hyphen between name and description | TSDoc grammar rules | Low | Syntax |
| DAR001 | darglint | Docstring syntax error preventing parsing | Docstring parser failure | Low | Syntax |
| DAR003 | darglint | Incorrect indentation in docstring | Indentation measurement | Low | Syntax |

### 4.2 Docstring Structure/Style Validation

| Check | Tool | What It Detects | Signal | False Positive Profile | Level |
|-------|------|----------------|--------|----------------------|-------|
| D200-D215 | pydocstyle | Whitespace issues: blank lines before/after docstrings, indentation, quote placement | AST docstring position + whitespace analysis | Low | Syntax |
| D300-D302 | pydocstyle | Quote style issues: not using triple double quotes, missing raw/unicode prefixes | String literal inspection | Low | Syntax |
| D400-D416 | pydocstyle | Content style: period at end, imperative mood, capitalization, section formatting | Regex on first line, section heading detection | Medium - imperative mood detection is heuristic | Syntax |
| D418 | pydocstyle | @overload function shouldn't have docstring | Decorator detection + docstring presence | Low | Structural |
| D419 | pydocstyle | Empty docstring | Docstring content check | Low | Syntax |
| GL01-GL10 | numpydoc | General layout: opening/closing quote position, section breaks, section order, reST directives | Docstring structure parsing | Low | Syntax |
| SS01-SS06 | numpydoc | Summary issues: missing, not capitalized, no period, whitespace, not imperative, too long | First line analysis | Medium - imperative mood is heuristic | Syntax |
| PR07-PR10 | numpydoc | Parameter description formatting: missing description, capitalization, period, colon spacing | Section content parsing | Low | Syntax |
| RT02-RT05 | numpydoc | Return description formatting | Section parsing | Low | Syntax |
| SA01-SA04 | numpydoc | See Also section: missing, period, capitalization, description presence | Section parsing | Medium | Syntax |
| EX01 | numpydoc | No examples section found | Section detection | Medium - not all items need examples | Structural |
| `match-description` | eslint-plugin-jsdoc | Description text doesn't match regex pattern (e.g., must start with capital) | Regex match on description text | Medium | Syntax |
| `informative-docs` | eslint-plugin-jsdoc | Doc comment just restates the name (e.g., "Gets the foo" for `getFoo()`) | Text similarity/pattern matching | High - aggressive heuristic | Behavioral |

---

## CATEGORY 5: CODE SNIPPET AND EXAMPLE VALIDATION

### 5.1 Compilable/Runnable Code Examples

| Check | Tool | What It Detects | Signal | False Positive Profile | Level |
|-------|------|----------------|--------|----------------------|-------|
| Doc tests (rustdoc) | rustdoc | Code examples in doc comments that fail to compile or run | Full Rust compiler + test runner | Low - compiler is authoritative | Behavioral |
| `check-examples` | eslint-plugin-jsdoc | JavaScript in @example tags that has ESLint errors | ESLint on extracted code blocks | Medium - example may be intentionally partial | Behavioral |
| `private_doc_tests` | rustdoc | Doc tests on private items | Visibility check on item with doc test | Low | Structural |

### 5.2 Code Block Formatting

| Check | Tool | What It Detects | Signal | False Positive Profile | Level |
|-------|------|----------------|--------|----------------------|-------|
| MD040 | markdownlint | Fenced code block without language specifier | Code fence regex + language attribute check | Low | Syntax |
| MD046 | markdownlint | Inconsistent code block style (fenced vs indented) | Code block type detection | Low | Syntax |
| MD048 | markdownlint | Inconsistent code fence style (backticks vs tildes) | Fence character detection | Low | Syntax |
| `unescaped_backticks` | rustdoc | Backticks in doc that indicate broken inline code | Backtick counting/matching | Medium | Syntax |

---

## CATEGORY 6: CODE-DOCUMENTATION DRIFT DETECTION (VCS-Based)

### 6.1 Patch-Based Snippet Tracking (Swimm)

| Check | Tool | What It Detects | Signal | False Positive Profile | Level |
|-------|------|----------------|--------|----------------------|-------|
| Patch Application | Swimm | Code snippet in doc has diverged from source file | git-apply of stored patch against new file version; failure = change detected | Low for detected changes; may miss semantic changes that don't affect patch | Structural |
| Change Classification | Swimm | Categorizes changes as: lint-character-only, inner-block, updatable-single-line, no-change, or non-updatable | Myers Diff algorithm on old vs new; line-level classification aggregated to overall verdict | Medium - classification thresholds are heuristic | Structural |
| Smart Token Tracking | Swimm | Variable/function name referenced in doc text has been renamed or removed | Token name tracking across commits; string matching in doc text | Low for renames; medium for similar-name collisions | Structural |
| Smart Path Tracking | Swimm | File path referenced in documentation no longer exists or has been moved | File system path resolution against repo | Low | Structural |
| Iterative Commit Processing | Swimm | Processes intermediate commits sequentially (not just start-to-end diff) to improve patch application success rate | Chronological commit iteration; each iteration's output becomes next input | Low | Structural |

### 6.2 Symbol-Based Drift Detection (DocSync)

| Check | Tool | What It Detects | Signal | False Positive Profile | Level |
|-------|------|----------------|--------|----------------------|-------|
| Undocumented Symbols | DocSync | New functions/classes added in staged files with no docs | Tree-sitter AST extraction on staged files; symbol lookup in doc files | Medium - may flag internal/private symbols | Structural |
| Stale Signatures | DocSync | Code signature changed but docs were not updated | Tree-sitter AST diff on function/class signatures vs doc content | Medium - not all signature changes affect docs | Structural |
| Dead References | DocSync | Deleted code still mentioned in documentation | Tree-sitter symbol extraction + doc content search for removed symbols | Low | Structural |

### 6.3 Code Element Reference Staleness (DOCER)

| Check | Tool | What It Detects | Signal | False Positive Profile | Level |
|-------|------|----------------|--------|----------------------|-------|
| Outdated Code References | DOCER | Code element names (functions, classes, variables) mentioned in README/wiki that no longer exist in code | Regex extraction of code elements from docs; compare against two code snapshots (when doc last updated vs current) | High - common words may match code element patterns; renamed vs deleted ambiguity | Structural |

---

## CATEGORY 7: FILE CO-CHANGE AND PROXIMITY RULES

### 7.1 Danger-js Co-Change Patterns

| Check | Tool | What It Detects | Signal | False Positive Profile | Level |
|-------|------|----------------|--------|----------------------|-------|
| CHANGELOG required | danger-js | Code files changed without CHANGELOG entry | `git.modified_files` check for CHANGELOG.md | Medium - not all changes need changelog | Structural |
| Tests required for code changes | danger-js | App code changed without corresponding test file changes | File path mapping (e.g., `src/foo.ts` => `test/foo.test.ts`) | Medium - refactoring may not need new tests | Structural |
| Docs required for API changes | danger-js | API/route/interface files changed without docs update | File glob matching (e.g., `routes/**` changed without `docs/**` changed) | Medium - internal refactors | Structural |
| Large PR without description | danger-js | PR diff exceeds line threshold but has no description | `danger.github.pr.body.length` + `git.lines_of_code` | Low | Structural |

---

## CATEGORY 8: MARKDOWN STRUCTURAL VALIDATION

### 8.1 Document Structure

| Check | Tool | What It Detects | Signal | False Positive Profile | Level |
|-------|------|----------------|--------|----------------------|-------|
| MD001 | markdownlint | Heading levels skip (e.g., h1 to h3) | Heading level sequence tracking | Low | Syntax |
| MD022 | markdownlint | Headings without blank lines before/after | Line-by-line context check | Low | Syntax |
| MD024 | markdownlint | Duplicate heading content in same document | Heading text comparison | Medium - legitimate repeated headings | Syntax |
| MD025 | markdownlint | Multiple top-level headings | h1 count | Low | Syntax |
| MD041 | markdownlint | First line is not a top-level heading | First content line analysis | Medium | Syntax |
| MD043 | markdownlint | Required heading structure not followed | Heading hierarchy vs configured required pattern | Low if properly configured | Structural |

### 8.2 Content Quality

| Check | Tool | What It Detects | Signal | False Positive Profile | Level |
|-------|------|----------------|--------|----------------------|-------|
| MD011 | markdownlint | Reversed link syntax `(text)[url]` instead of `[text](url)` | Pattern matching | Low | Syntax |
| MD042 | markdownlint | Empty link (no URL) | Link AST node URL check | Low | Syntax |
| MD044 | markdownlint | Proper nouns with wrong capitalization | Configured word list + case comparison | Low if properly configured | Syntax |
| MD045 | markdownlint | Images without alt text | Image AST node alt attribute check | Low | Syntax |
| MD059 | markdownlint | Non-descriptive link text (e.g., "click here") | Text pattern matching | Medium | Syntax |
| `no-eval-in-markdown` | Spectral | eval() function in API description text | String search | Low | Syntax |
| `no-script-tags-in-markdown` | Spectral | Script tags in API description markdown | HTML tag detection | Low | Syntax |

---

## CATEGORY 9: OPENAPI/API SPECIFICATION VALIDATION

### 9.1 Structural Completeness (Spectral)

| Check | Tool | What It Detects | Signal | False Positive Profile | Level |
|-------|------|----------------|--------|----------------------|-------|
| `info-contact` | Spectral | Missing contact object in info | JSON path existence check | Low | Structural |
| `info-description` | Spectral | Missing description in info object | Property presence check | Low | Structural |
| `info-license` | Spectral | Missing license in info | Property presence check | Low | Structural |
| `license-url` | Spectral | License missing URL | Property presence check | Low | Structural |
| `operation-description` | Spectral | Operation missing description | Property presence check | Low | Structural |
| `operation-operationId` | Spectral | Operation missing operationId | Property presence check | Low | Structural |
| `operation-operationId-unique` | Spectral | Duplicate operationId values | Value uniqueness check across all operations | Low | Structural |
| `operation-operationId-valid-in-url` | Spectral | operationId contains non-URL-safe characters | Character class validation | Low | Syntax |
| `operation-success-response` | Spectral | Operation has no 2xx or 3xx response | Response code pattern check | Low | Structural |
| `tag-description` | Spectral | Tag missing description | Property presence | Low | Structural |
| `contact-properties` | Spectral | Contact object missing name/url/email | Property presence check | Low | Structural |

### 9.2 Schema Consistency (Spectral)

| Check | Tool | What It Detects | Signal | False Positive Profile | Level |
|-------|------|----------------|--------|----------------------|-------|
| `path-params` | Spectral | Path parameter declared but not used, or used but not declared | Path template parsing + parameter object matching | Low | Structural |
| `path-declarations-must-exist` | Spectral | Empty path parameter declarations `{}` | Path template parsing | Low | Syntax |
| `path-keys-no-trailing-slash` | Spectral | Paths end with `/` | String suffix check | Low | Syntax |
| `path-not-include-query` | Spectral | Query strings in path definitions | String search for `?` | Low | Syntax |
| `operation-parameters` | Spectral | Duplicate parameters in operation | Parameter name+in uniqueness | Low | Structural |
| `typed-enum` | Spectral | Enum values don't match declared schema type | Type check on enum values | Low | Structural |
| `array-items` | Spectral | Array schema missing items definition | Schema type + items presence | Low | Structural |
| `duplicated-entry-in-enum` | Spectral | Duplicate values in enum array | Value uniqueness check | Low | Structural |
| `no-$ref-siblings` | Spectral | Properties alongside $ref (invalid in pre-3.1) | JSON object key analysis | Low | Structural |
| `oas2-unused-definition` / `oas3-unused-component` | Spectral | Schema definitions/components never referenced | Reference graph analysis | Low | Structural |
| `oas2-schema` / `oas3-schema` | Spectral | Schema doesn't conform to OpenAPI specification | JSON Schema validation | Low | Structural |
| `oas2/3-valid-media-example` | Spectral | Example values don't match their media type schema | Example value vs schema validation | Medium - complex schemas | Structural |
| `oas3-valid-schema-example` | Spectral | Schema example doesn't match type definition | Example vs type comparison | Medium | Structural |

### 9.3 API Breaking Change Detection (oasdiff)

oasdiff supports **250+ specific checks** across these categories:

| Check Category | What It Detects | Signal | Level |
|---------------|----------------|--------|-------|
| Endpoint removed | API path deleted between versions | Path set difference | Structural |
| HTTP method removed | Method removed from existing path | Method set difference | Structural |
| Required parameter added | New required parameter on existing endpoint | Parameter schema diff | Structural |
| Parameter removed | Previously documented parameter no longer present | Parameter set difference | Structural |
| Parameter type changed | Parameter type changed (e.g., string to integer) | Schema type comparison | Structural |
| Response removed | Previously documented response code removed | Response code set difference | Structural |
| Response property removed | Property removed from response schema | Schema property diff | Structural |
| Required property added to request | New required field in request body | Schema required array diff | Structural |
| Enum value removed | Value removed from enum | Enum set difference | Structural |
| Default value changed | Default value modified | Value comparison | Structural |
| Security scheme changed | Authentication requirements modified | Security scheme diff | Structural |

### 9.4 OpenAPI Validation (Mintlify)

| Check | Tool | What It Detects | Signal | False Positive Profile | Level |
|-------|------|----------------|--------|----------------------|-------|
| `openapi-check` | Mintlify CLI | OpenAPI spec file has validation errors | OpenAPI schema validation | Low | Structural |
| Auto-sync on spec change | Mintlify | OpenAPI spec changed but generated API docs not updated | File change detection + spec parsing | Low | Structural |

---

## CATEGORY 10: DEPRECATED/REMOVED ELEMENT DETECTION

| Check | Tool | What It Detects | Signal | False Positive Profile | Level |
|-------|------|----------------|--------|----------------------|-------|
| SA1019 | staticcheck (Go) | Code uses deprecated function/variable/constant/field | `// Deprecated:` comment annotation + usage analysis | Low - compiler-grade | Structural |
| `redundant_explicit_links` | rustdoc | Explicit doc links that duplicate what automatic linking would produce | Link comparison with auto-generated links | Low | Syntax |
| Deprecation-aware breaking changes | oasdiff | APIs deprecated without sufficient sunset period | Deprecation header + date analysis | Low | Structural |

---

## CATEGORY 11: MICROSOFT API EXTRACTOR (TypeScript)

| Check | Tool | What It Detects | Signal | False Positive Profile | Level |
|-------|------|----------------|--------|----------------------|-------|
| Missing release tags | API Extractor | Exported API item missing @public/@beta/@internal tag | TSDoc tag presence check | Medium | Structural |
| Inconsistent visibility | API Extractor | Public API references internal types | Export visibility graph analysis | Low | Structural |
| Missing exports | API Extractor | Type used in public API surface but not exported | TS symbol resolution | Low | Structural |
| API report diff | API Extractor | `.api.md` report file differs from generated output (API surface changed without review) | File content comparison | Low - intentional but very effective | Structural |

---

## CATEGORY 12: ADDITIONAL STRUCTURAL CHECKS

### 12.1 Class/Interface Documentation

| Check | Tool | What It Detects | Signal | False Positive Profile | Level |
|-------|------|----------------|--------|----------------------|-------|
| `implements-on-classes` | eslint-plugin-jsdoc | @implements used on non-class | AST node type check | Low | Structural |
| `check-indentation` | eslint-plugin-jsdoc | Inconsistent indentation in JSDoc block | Whitespace analysis | Low | Syntax |
| `check-alignment` | eslint-plugin-jsdoc | Tag alignment inconsistency | Column position analysis | Low | Syntax |
| `check-line-alignment` | eslint-plugin-jsdoc | Lines within JSDoc not aligned | Column analysis | Low | Syntax |

### 12.2 Tag Ordering and Organization

| Check | Tool | What It Detects | Signal | False Positive Profile | Level |
|-------|------|----------------|--------|----------------------|-------|
| `sort-tags` | eslint-plugin-jsdoc | JSDoc tags in wrong order | Tag order comparison against configured order | Low | Syntax |
| `tag-lines` | eslint-plugin-jsdoc | Wrong number of blank lines between tags | Line counting | Low | Syntax |
| GL06 | numpydoc | Unknown section name in docstring | Section name lookup against allowed list | Low | Structural |
| GL07 | numpydoc | Sections in wrong order | Section order comparison | Low | Structural |

---

## SUMMARY STATISTICS

| Category | Number of Distinct Checks | Primary Tools |
|----------|--------------------------|---------------|
| Signature Alignment (params, returns, types, throws, yields) | ~35 | eslint-plugin-jsdoc, darglint, numpydoc, pydocstyle, Java DocLint |
| Presence/Coverage | ~20 | interrogate, docstr-coverage, pylint, pydocstyle, rustdoc, TypeDoc, Java DocLint |
| Link/Reference Validation | ~20 | rustdoc, markdownlint, remark-validate-links, markdown-link-check, TypeDoc, Mintlify |
| Syntax/Structure | ~50 | markdownlint (60 rules), eslint-plugin-jsdoc (70 rules), pydocstyle (~40 rules), numpydoc (~30 rules) |
| Code Example Validation | ~5 | rustdoc (doctests), eslint-plugin-jsdoc (check-examples) |
| VCS-Based Drift Detection | ~8 | Swimm (patent US11132193B1), DocSync, DOCER |
| File Co-Change Rules | ~4 | danger-js (custom Dangerfile rules) |
| API Spec Validation | ~55+ Spectral rules, 250+ oasdiff checks | Spectral, oasdiff, Optic, Mintlify |
| Deprecated/Removed Detection | ~3 | staticcheck (Go), oasdiff |

**Total distinct deterministic checks identified: ~400+**

---

## KEY GAPS RELEVANT TO DOCALIGN

Based on this inventory compared to what tools actually ship, these are the areas where coverage is thinnest and opportunity is greatest:

1. **Cross-file claim-to-code mapping** -- Most tools check doc comments adjacent to code (same file). Very few tools (only Swimm, DocSync, DOCER) attempt to match prose documentation (README, guides, wiki) against code in different files. This is DocAlign's core value proposition.

2. **Behavioral/semantic verification** -- Almost all checks are syntax-level or structural-level. Very few verify behavioral claims (e.g., "this function returns null when the user is not found" -- does it actually?). Only rustdoc doctests approach this, and only for Rust.

3. **API documentation vs implementation drift** -- Spectral/oasdiff validate specs against themselves or against spec versions, but not against the actual running code. The gap between "what the OpenAPI spec says" and "what the Express route handler actually does" is unaddressed by any production tool.

4. **Configuration documentation drift** -- No tool validates that documented config options (env vars, CLI flags, YAML keys) actually exist in the code that reads them.

5. **Import/dependency claims** -- No tool validates that `import` statements shown in documentation code blocks are actually valid (correct package names, correct export names).

6. **Architecture documentation drift** -- No tool validates high-level architecture claims (e.g., "Service A calls Service B") against actual code structure.</result>
<usage>total_tokens: 102070
tool_uses: 69
duration_ms: 977595</usage>
</task-notification>
Full transcript available at: /private/tmp/claude-501/-Users-kotkot-Discovery-docalign/tasks/a5c6edc.output

## Summary

The gap analysis is at `_planning/context/competitors/deterministic-gap-analysis.md`.

## Summary

We're actually strong where it matters most — **claim verification against code** (paths, commands, versions, routes, code examples). No competitor matches our L1→L2→L3 pipeline for prose documentation. But we're missing basic hygiene checks that make us look incomplete:

### P0 — Add now (low effort, table-stakes):
1. **Dead link detection** — HTTP check on URLs in docs. Every doc tool has this. We don't.
2. **Anchor/heading validation** — `[text](file.md#section)` where `#section` doesn't exist. Low effort, zero false positives.
3. **Missing documentation detection** — "this exported function has zero docs mentioning it." We already have the data in L0 + L2 reverse index. It's one SQL query away.

### P1 — Add now (medium effort, high differentiation):
4. **Deprecation awareness** — Flag when docs reference `@deprecated` code. Extend L0 entity extraction.
5. **Env var / config verification** — "README says set `DATABASE_URL`" → search code for `process.env.DATABASE_URL`. Nobody does this. Index env var reads as a special entity type in L0.
6. **PR-scoped scanning** — Verify the default PR flow only checks claims mapped to changed files (reverse index). Noise reduction #1.
7. **Fuzzy suggestions for ALL claim types** — When a dependency/symbol/route isn't found, suggest closest match via Levenshtein. Turns bare "drifted" into actionable "did you mean X?"

### P2 — v1.5:
8. **Simplified snippet staleness** — Match code blocks to source entities, compare content. Lighter than Swimm's patented approach.
9. **Cross-document consistency** — Flag when two docs make contradictory claims about the same entity.

### Key techniques to inherit:
- **Swimm:** Context-aware Levenshtein (40%/90% thresholds), iterative commit processing
- **oasdiff:** ERR/WARN/INFO severity classification for all checks
- **DocSync:** `--staged` pre-commit hook mode for fast local feedback
- **API Extractor:** Generate a committed report file that makes drift visible in code review

## Key Actions

- - **Write**: /Users/kotkot/Discovery/docalign/_planning/context/competitors/deterministic-gap-analysis.md
