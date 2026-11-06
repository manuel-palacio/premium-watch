#!/bin/zsh
# Unattended holdings update, invoked by launchd (com.premiumwatch.holdings) on weekdays at 21:00
# local time, after US filings and before the 18:30 New York close run. Logs to
# ~/Library/Logs/premium-watch/.
#
# Each company gets one headless Claude Code run limited to WebSearch and WebFetch (no permission
# bypass). Proposals are written to the production ledger only after the checks in
# job/src/holdings/check.ts and an independent fetch of the source; see `npm run update-holdings`.
# Needs: `gcloud auth application-default login` (Firestore), the Claude login, and
# SEC_USER_AGENT in config/deploy.env.
set -u
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
export HOME=${HOME:-/Users/manuel}
unset ANTHROPIC_API_KEY
# Long-lived subscription token from `claude setup-token`, kept in the Keychain (service claude-code,
# account oauth-token), so an expired or rotated interactive login cannot break this unattended run.
# Without the item, Claude Code falls back to the normal login.
if _tok=$(security find-generic-password -s claude-code -a oauth-token -w 2>/dev/null) && [[ -n $_tok ]]; then
  export CLAUDE_CODE_OAUTH_TOKEN=$_tok
fi
unset _tok
REPO=/Users/manuel/Projects/premium-watch
LOGDIR=$HOME/Library/Logs/premium-watch

mkdir -p "$LOGDIR"
LOG="$LOGDIR/holdings-$(date +%Y-%m-%d_%H%M).log"
exec >>"$LOG" 2>&1
echo "=== $(date) start ==="

notify() { command -v tg-notify >/dev/null && { tg-notify "$1" || echo "WARN: tg-notify failed"; }; return 0; }
fail() { echo "ERROR: $1"; notify "❌ premium-watch holdings update FAILED: $1
$(tail -n 12 "$LOG")"; exit 1; }

cd "$REPO" || fail "repo missing"
grep -q '^SEC_USER_AGENT=..' config/deploy.env || fail "SEC_USER_AGENT is not set in config/deploy.env"

OUT=$(mktemp -t holdings-out)
# Watchdog: one research run per company; kill the whole thing after 90 minutes.
caffeinate -i -s npm run --silent update-holdings -- "$@" 2>&1 | tee "$OUT" &
run_pid=$!
( sleep 5400; echo "WATCHDOG: 90 min deadline hit, killing run"; pkill -P $run_pid; kill $run_pid ) 2>/dev/null &
wd_pid=$!
wait $run_pid; rc=$?
kill $wd_pid 2>/dev/null
echo "=== $(date) exited rc=$rc ==="

# Commit and push the auto-*.csv records of what was added. Only those paths are committed, so
# other work in progress in the repo is left alone. A failure here is reported but doesn't fail
# the run: the ledger is already written.
commit_records() {
  local files; files=$(git ls-files --others --modified -- 'data/ledger/auto-*.csv')
  [ -n "$files" ] || return 0
  echo "$files" | xargs git add -- &&
    echo "$files" | xargs git commit -q -m "Ledger: auto holdings records $(date +%Y-%m-%d)" -- &&
    git push -q origin HEAD ||
    notify "⚠️ premium-watch: holdings records not committed/pushed, see $LOG"
}
[ $rc -eq 0 ] && commit_records

SUMMARY=$(sed -n '/^holdings update /,$p' "$OUT")
if [ $rc -eq 0 ] && [ -n "$SUMMARY" ]; then
  case "$SUMMARY" in
    *" 0 added, 0 to review"*) echo "nothing new; no notification" ;;
    *) notify "📈 $SUMMARY" ;;
  esac
else
  notify "❌ premium-watch holdings update rc=$rc
${SUMMARY:-$(tail -n 12 "$LOG")}"
fi
rm -f "$OUT"
exit $rc
