# Changelog

## [Unreleased]

### Added

- `dsh://` handler registered on `uriRegistry`: root listing, `docs/` alias, per-doc reads, traversal/absolute-path rejection, did-you-mean suggestions.
- `corpus/` data directory with the official deepseek-harness docs (215 files) and `index.txt`, refreshed via `pnpm sync-corpus`.
- Static `overview.md` fallback doc shipped in code.
- Contract tests (node:test) over a temp corpus fixture.

## [0.1.0] - 2026-08-13

### Added

- Initial port of omp's `OmpProtocolHandler` + `docs-index` as a DSH content-layer plugin.
