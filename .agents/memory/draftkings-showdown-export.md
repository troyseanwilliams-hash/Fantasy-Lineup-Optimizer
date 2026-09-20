---
name: DraftKings Showdown export
description: External CSV header format required for DraftKings Showdown lineup uploads.
---

DraftKings Showdown CSV headers use one captain column followed by repeated generic flex columns: `CPT,FLEX,FLEX,FLEX,FLEX,FLEX` for a six-player DraftKings Showdown roster. Internal keys such as FLEX1 through FLEX5 must not be emitted as upload headers.

**Why:** DraftKings rejects a CSV with numbered flex header names as an “Incorrect file header column!” error even though the saved lineup uses numbered internal slots.

**How to apply:** Keep internal slot identifiers for ordering and assignment, but normalize the DraftKings upload header to `CPT` plus repeated `FLEX` labels.