#!/usr/bin/env bash
# BetHouse local gate — tailored from the Altera Claude Code Standard.
# Mirrors .github/workflows/ci.yml: the real test command + (if installed) a secret scan.
# Run this before you push.  Green here == green in CI.
#
#   bash scripts/local-check.sh
set -uo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)"
fail=0

echo "== freshness =="
node provenance.mjs || { echo "   ^ pull before trusting any number this run prints"; fail=1; }

echo "== tests: node --test edge.test.mjs score.test.mjs golf.test.mjs nfl.test.mjs bets.test.mjs track.test.mjs clv.test.mjs provenance.test.mjs dom.test.mjs =="
node --test edge.test.mjs score.test.mjs golf.test.mjs nfl.test.mjs bets.test.mjs track.test.mjs clv.test.mjs provenance.test.mjs dom.test.mjs || fail=1

echo
echo "== secrets: gitleaks =="
if command -v gitleaks >/dev/null 2>&1; then
  gitleaks detect --redact --no-banner || fail=1
elif command -v pre-commit >/dev/null 2>&1; then
  # pre-commit vendors gitleaks; run just that hook across the repo
  pre-commit run gitleaks --all-files || fail=1
else
  echo "  ⚠️  gitleaks not found and pre-commit not installed — secret scan skipped."
  echo "     CI still runs it; install pre-commit to mirror CI locally."
fi

echo
if [ "$fail" -ne 0 ]; then
  echo "❌ local checks FAILED — fix before pushing."
  exit 1
fi
echo "✅ passed — mirrors CI."
