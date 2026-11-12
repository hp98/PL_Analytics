#!/usr/bin/env bash
# Near-real-time data refresh.
#
# Repeatedly runs the LIGHT publish (live bootstrap-derived bundles only: prices,
# ownership, transfer momentum, fixtures, ticker). It deliberately skips the
# parquet export and the projection/optimiser model, whose inputs only change
# when a gameweek completes — so each pass costs seconds, not minutes.
#
#   INTERVAL=300 ./scripts_refresh_loop.sh     # default: every 5 minutes
#
# Stop it with Ctrl-C (or by stopping the background task that launched it).
set -u
INTERVAL="${INTERVAL:-300}"
cd "$(dirname "$0")"
echo "refresh loop: light publish every ${INTERVAL}s (Ctrl-C to stop)"
while true; do
  START=$(date +%s)
  if UV_LINK_MODE=copy PYTHONUTF8=1 uv run python -m pipeline.run_publish --light > /tmp/fpl_refresh.log 2>&1; then
    echo "$(date -u +%H:%M:%S) refreshed in $(( $(date +%s) - START ))s"
  else
    echo "$(date -u +%H:%M:%S) refresh FAILED (see /tmp/fpl_refresh.log) — retrying next tick"
  fi
  sleep "$INTERVAL"
done
