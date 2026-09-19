---
name: YouTube integration scope
description: Records that YouTube OAuth is intentionally excluded from this project.
---

Do not add or restore YouTube OAuth, YouTube connection settings, token storage, routes, or related database tables in this project.

**Why:** The user identified the YouTube integration as work for a different site. Its leftover development table later caused an unrelated publish attempt to fail during production schema migration.

**How to apply:** Treat any proposed YouTube account connection work here as out of scope unless the user explicitly reverses this decision. A rollback must remove both code and development-schema residue before publishing.