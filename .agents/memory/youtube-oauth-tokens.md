---
name: YouTube OAuth tokens
description: Security and persistence convention for per-user YouTube authorization grants.
---

Store YouTube OAuth access and refresh tokens only in the dedicated per-user connection record, encrypted at rest with a key derived from the server session secret. Never return either token to the browser.

**Why:** YouTube refresh tokens are long-lived account credentials. Session-only storage would lose authorization, while plaintext database storage would unnecessarily expose credentials.

**How to apply:** All future YouTube API operations must load and decrypt tokens server-side, refresh expired access tokens server-side, and expose only non-sensitive channel status to clients.