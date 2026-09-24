---
name: NFL research-station projection CSVs
description: Duplicate projection headers in weekly research-station exports.
---

Research-station CSV exports can repeat `DKProj` and `FDProj` headers. The first occurrence holds the DraftKings or FanDuel platform projection; later occurrences belong to prop-projection sections and may differ.

**Why:** Flattening repeated headers into a plain object can silently keep the later value and replace the platform projection with an unrelated prop projection.

**How to apply:** Preserve column order or use group-aware headers, select the first platform projection columns, and cross-check position-specific files against the combined offense file when available.