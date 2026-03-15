This project is an NPM package called "@lipsumar/claudeflow":

- uses Yarn v4
- bundled with tsdown
- tested with vitest (`yarn test`)
- Node 24 (version pinned in `.nvmrc`)
- main branch is `master`
- CI runs on GitHub Actions (`.github/workflows/ci.yml`)

claudeflow is a Node.js library and CLI tool for defining and running workflows composed of scripted nodes and Claude Code nodes. Claude Code nodes run inside throwaway Docker containers with network isolation via Squid proxy.

See the full spec in [specs/](./specs/index.md).

## Project structure

- `src/index.ts` — Library public API (re-exports)
- `src/config.ts` — `defineConfig()` and `ClaudeflowConfig` type
- `src/workflow/` — Core workflow engine
- `src/nodes/` — Node type factories
- `src/sandbox/` — Docker isolation layer
- `src/auth-proxy/` — Minimal HTTP proxy that injects the real ANTHROPIC_API_KEY
- `src/store/` — run history persistence
- `src/cli/` — CLI entrypoint and commands
- `docker/` — Dockerfiles and docker-compose for infrastructure
- `specs/` — Project specification

## Tests

- Unit tests live in `src/` next to the code they test (e.g. `src/foo.spec.ts`)
- Integration tests live in `tests/` (e.g. `tests/cli.spec.ts`)
- `tests/helpers.ts` — shared test utilities (e.g. `runCli()`)

## Build

Two tsdown entrypoints:

- `src/index.ts` → `dist/index.mjs` (library, exposed via package.json `exports`)
- `src/cli/index.ts` → `dist/cli/index.mjs` (CLI, exposed via package.json `bin`)
