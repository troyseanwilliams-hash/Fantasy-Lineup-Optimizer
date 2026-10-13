---
name: Historical data retention
description: User-approved indefinite retention of saved lineups and player history.
---
Keep saved lineups (including Review records) and player history indefinitely for analysis. Manual deletion remains available.
The user wants older lineups in a History tab, separate from Active Lineups.

**Why:** The user explicitly approved indefinite retention after learning about the three-hour startup, 24-hour Review, and 14-day player-history deletion rules.

**How to apply:** Do not add automatic age-based deletion at startup, in scheduled jobs, or on reads. Collection/backfill lookback windows do not define retention.
