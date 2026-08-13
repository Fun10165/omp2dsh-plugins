# Changelog

## [Unreleased]

### Added

- URI protocol registry service (`uriRegistry`): `register` / `unregister` / `resolve` / `complete` / `listSchemes` / `normalizePath`, published via `ctx.provide('uriRegistry')`.
- `read_uri` model tool: resolves any registered `scheme://` URL through the registry.
- Traversal and absolute-path rejection shared via `normalizePath` (ported from omp's OmpProtocolHandler).
- Contract tests (node:test) covering routing, normalization, security, completion, and lifecycle.

## [0.1.0] - 2026-08-13

### Added

- Initial port of omp's `InternalUrlRouter` as a standalone DSH plugin package.
