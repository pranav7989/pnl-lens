#!/usr/bin/env bash
# @file  infra/scripts/check-secrets.sh
# @area  Ops
# @what  Secret scan of the whole git history and the working tree with gitleaks (pinned image); fails on any finding. Used by CI.
set -euo pipefail
cd "$(dirname "$0")/../.."
IMAGE=zricethezav/gitleaks:v8.30.1
CONFIG=/repo/infra/security/gitleaks.toml
docker run --rm -v "$PWD:/repo:ro" -w /repo "$IMAGE" git --redact --no-banner --config "$CONFIG" /repo
docker run --rm -v "$PWD:/repo:ro" -w /repo "$IMAGE" dir --redact --no-banner --config "$CONFIG" /repo
# The template must never carry a value for a secret-like variable (gitleaks skips it: empty lines confuse its generic rule).
bad=$(grep -E '^[A-Z0-9_]*(SECRET|PASSWORD|TOKEN|PEPPER|API_KEY|ACCESS_KEY|KEK_K[0-9A-Z]*)[A-Z0-9_]*=.+' .env.example || true)
if [ -n "$bad" ]; then echo "FAIL: .env.example has values for secret variables:"; echo "$bad" | sed 's/=.*/=<redacted>/'; exit 1; fi
echo ".env.example: all secret variables are empty"
