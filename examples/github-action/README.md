# GitHub Action Example

Shows how to run DocAlign as a GitHub Action on pull requests.

## Contents

- `docalign.yml` — A workflow file you can copy into `.github/workflows/`

## Setup

1. Copy `docalign.yml` to your repo's `.github/workflows/` directory
2. The action runs on every pull request targeting `main`
3. DocAlign posts a comment on the PR with any documentation drift found

## How It Works

The workflow uses the DocAlign agent-action to scan changed files,
verify documentation claims, and report results directly on the PR.
