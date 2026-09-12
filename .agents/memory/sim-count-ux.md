---
name: Sim count UX
description: User-confirmed separation of Normal and Sim lineup count controls.
---

Sim Mode uses its own count buttons to request simulated lineups. Do not repurpose the Normal Qty slider for Sim Mode; hide it on all viewport sizes while Sim is selected.

**Why:** The user explicitly rejected sharing Normal Qty with Sim because two visible count controls made it unclear which governed generation.

**How to apply:** Keep requests, action labels, empty states, and count-dependent controls consistent with the selected mode. Explain that unique results may be fewer than requested; do not promise that every simulation yields a distinct lineup.