---
name: Soccer team logos (national teams)
description: Why soccer/World Cup team logos must use country flags, not ESPN club-logo paths
---

# Soccer national-team logos

ESPN's `teamlogos/soccer/500/{abbrev}.png` path 404s for national-team
abbreviations (BEL, EGY, ESP, CPV, IRN, NZL, KSA, URU, ...). The generic
TeamLogo fallback was an NBA image, which looks broken/off-brand on soccer UI.

**Rule:** For `sport === "SOCCER"`, render country flags via
`https://flagcdn.com/w80/{iso2}.png`, mapping FIFA 3-letter codes → ISO 3166-1
alpha-2 (`FIFA_TO_ISO2` in `client/src/pages/Home.tsx`). flagcdn supports UK
subdivisions (`gb-eng`, `gb-sct`, `gb-wls`). Unmapped codes fall back to a
text badge showing the abbrev — never the NBA image.

**Why:** Soccer is configured as FIFA World Cup; teams are countries, so flags
are correct and reliable where club-logo paths are not.
**How to apply:** When adding any soccer logo, extend `FIFA_TO_ISO2` for new
nations rather than relying on ESPN abbrev paths.
