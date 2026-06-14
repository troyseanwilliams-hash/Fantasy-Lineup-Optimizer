---
name: Log inspection on restarts
description: How to read current workflow logs after a restart_workflow call
---
Use `refresh_all_logs` (not manual `ls -t /tmp/logs/*.log` + tail) to get the authoritative current log file after a restart.

**Why:** `restart_workflow` does not always rotate the on-disk log filename; manually tailing the "newest" file by mtime can show a stale previous-process startup sequence, leading to false conclusions that code edits didn't take effect.

**How to apply:** After restarting a workflow to verify a code change, call `refresh_all_logs` and read the file path it reports, rather than guessing the newest log file yourself.
