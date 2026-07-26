#!/usr/bin/env bash
# Assemble the static site served at agent-flow.pulsar-projects.org.
# The player is fully self-contained (workflow data is embedded in
# workflows.js), so there's nothing to fetch and no build step beyond copying.
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf deploy
mkdir -p deploy
cp ui/index.html ui/about.html ui/app.js ui/style.css ui/workflows.js deploy/

echo "built deploy/ ($(find deploy -type f | wc -l | tr -d ' ') files)"
