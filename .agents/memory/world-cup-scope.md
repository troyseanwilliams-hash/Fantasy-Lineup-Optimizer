---
name: World Cup scope
description: Project decision to keep World Cup-specific product surfaces disabled.
---

World Cup-specific promotions, the builder page, and FIFA-specific API/feed integrations are disabled. Generic soccer remains an off-season sport rather than an active World Cup product.

**Why:** The user asked to turn off anything World Cup related, so the product must not promote or expose that competition while unrelated NFL, MLB, Golf, and other supported features continue to work.

**How to apply:** Keep the shared World Cup feature flag disabled, do not restore the World Cup navigation or route, and return a disabled response from legacy World Cup API paths.