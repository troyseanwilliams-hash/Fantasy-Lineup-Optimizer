---
name: Playwright post-merge setup
description: Browser provisioning required for the project's post-merge validation workflow.
---

The post-merge setup must provision the Playwright Chromium browser before running the production build.

**Why:** The repository can have the Playwright package installed while the browser executable is absent from the workspace cache, causing every browser test to fail before any assertion runs.

**How to apply:** Keep the post-merge script non-interactive and run `npx playwright install chromium` before build/validation steps.

Run browser validation on an isolated server rather than reusing the preview server.

**Why:** Managed preview and completion validation can run concurrently. Reusing the preview port attached tests to stale application state and caused widespread missing-selector failures.

**How to apply:** Keep validation's port separate from preview and require Playwright to start its own server; do not weaken page assertions to accommodate stale-server failures.