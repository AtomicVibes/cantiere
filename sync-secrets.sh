#!/usr/bin/env bash
# sync-secrets.sh — Upload .env variables as Cloudflare Pages secrets via Wrangler.
# Usage: ./sync-secrets.sh [env-file]
#
# To unset a secret, set its value to empty in the .env file (KEY=).
# Lines starting with # and blank lines are ignored.
#
# Project name is read from wrangler.jsonc. Override with: --name <project>

set -euo pipefail

ENV_FILE="${1:-.env}"

# ── Help ──────────────────────────────────────────────────────────────
if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  sed -n 's/^# //p; /^$/q' "$0"
  exit 0
fi

# ── Validate input file ───────────────────────────────────────────────
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: File '$ENV_FILE' not found." >&2
  exit 1
fi

# ── Read project name from wrangler.jsonc ─────────────────────────────
WRANGLER_CONFIG="wrangler.jsonc"
PAGES_NAME=""

if [[ -f "$WRANGLER_CONFIG" ]]; then
  PAGES_NAME=$(grep -E '^\s*"name"' "$WRANGLER_CONFIG" \
    | sed -E 's/.*"name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')
fi

if [[ -z "$PAGES_NAME" ]]; then
  echo "Error: Could not determine Pages project name from $WRANGLER_CONFIG." >&2
  exit 1
fi
echo "Targeting Pages project: $PAGES_NAME"

# ── Authentication check ──────────────────────────────────────────────
echo "Checking Cloudflare authentication..."
if ! npx wrangler whoami &>/dev/null; then
  echo "Error: Not authenticated with Cloudflare." >&2
  echo "Run 'npx wrangler login' or set CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID." >&2
  exit 1
fi
echo "Authentication OK."
echo

# ── Upload secrets ────────────────────────────────────────────────────
ERRORS=()

while IFS= read -r line; do
  # Skip blank lines
  [[ -z "$line" ]] && continue

  # Skip comment lines (optional whitespace then #)
  [[ "$line" =~ ^[[:space:]]*# ]] && continue

  # Must contain at least one '='
  if [[ "$line" != *"="* ]]; then
    echo "Warning: Skipping malformed line (no '='): $line" >&2
    continue
  fi

  # Split on first '='
  key="${line%%=*}"

  # Trim whitespace from key
  key="${key#"${key%%[![:space:]]*}"}"
  key="${key%"${key##*[![:space:]]}"}"

  # Validate key (must be a valid environment variable name)
  if [[ ! "$key" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
    echo "Warning: Skipping invalid key '$key'" >&2
    continue
  fi

  value="${line#*=}"

  echo "  Setting secret: $key"
  if ! printf '%s' "$value" \
    | env WRANGLER_NO_UPDATE_NOTIFIER=1 npx --yes wrangler pages secret put "$key" --name "$PAGES_NAME" 2>/dev/null; then
    echo "  Error: Failed to set '$key'" >&2
    ERRORS+=("$key")
  fi
done < "$ENV_FILE"

# ── Report ────────────────────────────────────────────────────────────
echo
if [[ ${#ERRORS[@]} -eq 0 ]]; then
  echo "Done — all secrets uploaded successfully."
else
  echo "Done with ${#ERRORS[@]} error(s) for:"
  printf '  - %s\n' "${ERRORS[@]}"
  exit 1
fi
