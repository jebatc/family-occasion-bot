#!/bin/sh
# Runs the bot as a macOS background service (LaunchAgent): starts at login, restarts if it crashes,
# keeps the Mac awake while it runs. Usage: scripts/bot-service.sh install|uninstall|restart|status|logs
set -eu
LABEL=com.holiday-coordinator.bot
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DIR=$(cd "$(dirname "$0")/.." && pwd)
LOG="$DIR/private/logs/bot.log"
NODE=$(command -v node)
TARGET="gui/$(id -u)"

case "${1:-}" in
  install)
    if pgrep -f "src/cli.ts serve" >/dev/null && ! launchctl print "$TARGET/$LABEL" >/dev/null 2>&1; then
      echo "The bot is already running in a terminal. Stop it there (Ctrl+C) first, so two copies don't fight." >&2; exit 1
    fi
    mkdir -p "$(dirname "$LOG")" "$(dirname "$PLIST")"
    cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/caffeinate</string><string>-i</string>
    <string>$NODE</string><string>src/cli.ts</string><string>serve</string>
  </array>
  <key>RunAtLoad</key><true/>
  <!-- restart after a crash, but not after a clean exit (logged out, or another copy took over: those need a person) -->
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST
    launchctl bootout "$TARGET/$LABEL" 2>/dev/null || true
    launchctl bootstrap "$TARGET" "$PLIST"
    echo "Installed. The bot starts now and at every login. Logs: $LOG" ;;
  uninstall)
    launchctl bootout "$TARGET/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"; echo "Removed; the bot won't start on its own anymore." ;;
  restart)
    launchctl kickstart -k "$TARGET/$LABEL"; echo "Restarted." ;;
  status)
    if launchctl print "$TARGET/$LABEL" >/dev/null 2>&1; then
      launchctl print "$TARGET/$LABEL" | grep -E "^\s+(state|pid|last exit code) =" | sed 's/^\s*//'
    else echo "Not installed."; fi
    tail -n 3 "$LOG" 2>/dev/null || true ;;
  logs)
    tail -n 40 -f "$LOG" ;;
  *) echo "Usage: $0 install|uninstall|restart|status|logs" >&2; exit 1 ;;
esac
