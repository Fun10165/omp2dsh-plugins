#!/usr/bin/env bash
# Sync the official deepseek-harness docs corpus into packages/dsh-docs/corpus/.
#
# Usage:
#   pnpm sync-corpus                # use ../deepseek-harness/docs next to this repo
#   pnpm sync-corpus <docsDir>      # point at any checkout of deepseek-harness/docs
#
# The corpus is the "content half" of @omp2dsh/dsh-docs: it ships inside the
# package and can be refreshed independently of plugin code (KISS: content and
# code are separate layers — see AGENTS.md).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="$REPO_ROOT/packages/dsh-docs/corpus"

if [[ $# -ge 1 ]]; then
  SRC="$1"
else
  SRC="$REPO_ROOT/../deepseek-harness/docs"
fi

if [[ ! -d "$SRC" ]]; then
  echo "error: docs source not found: $SRC" >&2
  echo "hint: clone it first: git clone --depth 1 https://github.com/deepseek-ai/deepseek-harness.git" >&2
  exit 1
fi

rm -rf "$TARGET"
mkdir -p "$TARGET"
# Copy only the markdown tree (skip i18n yaml sidecars and anything non-md).
( cd "$SRC" && find . -name '*.md' -print0 | sort -z | while IFS= read -r -d '' f; do
    dest="$TARGET/${f#./}"
    mkdir -p "$(dirname "$dest")"
    cp "$f" "$dest"
  done )

# Regenerate the index: one relative path per line, no ./ prefix.
( cd "$TARGET" && find . -name '*.md' -print | sort | sed 's|^\./||' > index.txt )

COUNT=$(wc -l < "$TARGET/index.txt" | tr -d ' ')
echo "synced $COUNT documents -> $TARGET"
