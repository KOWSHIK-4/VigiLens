#!/bin/sh
# Runs before the stock envsubst step (20-envsubst-on-templates.sh) so the
# INTERNAL_KEY_HEADER variable it exports is available to the template.
set -e

if [ -n "${INTERNAL_API_KEY:-}" ]; then
    INTERNAL_KEY_HEADER="proxy_set_header X-Internal-Key ${INTERNAL_API_KEY};"
else
    # No secret configured (local dev): proxy without the header; the AI
    # service skips its internal-key check outside production.
    INTERNAL_KEY_HEADER=""
fi
export INTERNAL_KEY_HEADER
