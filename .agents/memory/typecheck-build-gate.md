---
name: TypeScript checking vs build gate
description: The project does NOT pass `tsc --noEmit`; esbuild/vite is the real build gate
---

# tsc is not the gate

`npx tsc --noEmit` reports many PRE-EXISTING errors across the project
(e.g. `scoutSignals` missing on `LandingResponse`, `string`→`Sport` union in
`useState(ACTIVE_SPORTS[0] || "SOCCER")`, `app.tsx`/`App.tsx` casing,
downlevelIteration on Map/Set, `@shared/routes` missing exports). The app still
runs fine because **esbuild/vite strips types and builds regardless**.

**Rule:** When validating a change, do not treat raw `tsc --noEmit` output as a
pass/fail gate. Instead diff errors against HEAD (or filter to the files you
touched) to find errors *newly introduced* by your change. Confirm the running
app via workflow logs + screenshot.
**Why:** Blindly "fixing" all tsc errors here is out of scope and risks churn on
unrelated pre-existing issues.
