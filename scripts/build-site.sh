#!/usr/bin/env bash
# Assemble the static site served at gossip-rag.pulsar-projects.org.
# The viewer fetches ../traces/* ; served from the domain root that clamps to
# /traces/*, so we place the ui files at the root and traces/ beside them.
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf deploy
mkdir -p deploy/traces
cp ui/index.html ui/app.js ui/style.css ui/graph-view.js deploy/
cp traces/*.json deploy/traces/

echo "built deploy/ ($(find deploy -type f | wc -l | tr -d ' ') files)"
