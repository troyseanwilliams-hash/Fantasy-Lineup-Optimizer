---
name: Slate refresh lineup integrity
description: Data-integrity rules for refreshing contest player pools without corrupting saved lineups.
---

Refresh players for the same slate in place using stable platform player IDs. Do not clear all slates or replace player rows during scheduled refreshes.

**Why:** Saved lineups reference internal player IDs. Deleting and recreating player rows or clearing all slates orphans those references and can also race with concurrent ingestion.

**How to apply:** Update matched players transactionally, insert new players, and reconcile players absent from a complete feed. Delete only unreferenced stale rows. Keep stale rows referenced by saved lineups resolvable but durably marked OUT with zero projection so status sync cannot make them optimizer-eligible again. When a slate truly rolls over, keep referenced old slates inactive for history and create a new slate.