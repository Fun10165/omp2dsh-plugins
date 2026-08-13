# Changelog

## [Unreleased]

### Fixed

- Forward the command invocation signal into the shell execution so long-running commands (e.g. `/b sleep 100`) are cancellable instead of holding the session; already-aborted signals reject before execution.
- Add `/bq` cancel command: the official Web UI never aborts the command signal (ui-commands executes without one; gateway falls back to NEVER_ABORTED_SIGNAL), so bang now owns an AbortController registry — `/bq <cmd>` aborts by exact text, bare `/bq` aborts the most recent run.
- Include the exit code in the injected context message (`> /b <cmd> [exit N]`) so the model knows whether the command succeeded.
- `/b` now executes in the background: the handler returns immediately so the composer claim releases and the user can type `/bq` (or keep chatting) while the shell runs; the result is injected into context when it settles. `/bb` stays synchronous because its result can only render on the card.

### Added

- `createBangRunner` host core: `run` (shell + sandboxPolicy + session cwd), `note` (plugin user message into the session flow without waking the driver), `currentCwd`.
- Client draft parsing (`parseBangDraft`: `!`/`!!` prefixes) and execution orchestration (`executeBang`: run → optional context injection → dock state).
- DSH-philosophy contract: `!!` results never reach `note` (excluded from context) and the dock labels them explicitly; `!` results are injected and labeled.
- Contract tests (node:test): runner normalization/errors/policy resolution, draft parsing, note-injection vs excluded behavior.

## [0.1.0] - 2026-08-13

### Added

- Initial port of omp's bang/bash input mode as a DSH plugin package.
