---
name: Slate expiration timing
description: Lifecycle rule for deciding when multi-game DFS slates should become inactive.
---

Expire multi-game slates only after the grace period following the latest game start represented in the player pool. Do not base expiration solely on the slate start time.

**Why:** A slate’s stored start time is its first kickoff. First-kickoff cleanup can hide the slate and all players while later games are still active, and ingestion may then skip replacement because it correctly recognizes the existing player pool as ongoing.

**How to apply:** Any cleanup, slate-list filtering, or ingestion replacement decision must derive the latest game time consistently and use the same grace period.