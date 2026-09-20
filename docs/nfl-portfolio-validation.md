# NFL portfolio historical validation

The version 1 snapshot format supports reproducible, walk-forward validation for
DraftKings NFL Classic slates. A valid snapshot records a player pool,
safe solver constraints, strategy settings, and the exact as-of times for
projections and any ownership or Vegas inputs. `capturedAt` must precede slate
lock, and every input as-of time must be no later than `capturedAt`. Actual
points are stored separately and must have been observed after lock.

Use the pure route helper:

```ts
createNflPortfolioValidationSnapshot({
  slateStartTime, capturedAt, projectionsAsOf, settingsAsOf,
  pool, constraints, settings,
  ownership: { source, provenance: "provided" | "estimated", asOf, values }, // or null
  vegas: { asOf, games },              // or null
  actuals: { observedAt, points },      // may be null until results exist
})
```

The returned value is validated, deeply frozen, JSON-serializable, and contains
no authentication or user identity fields. Current ownership and Vegas API
responses have unknown historical as-of provenance unless that provenance was
recorded at ingestion. Callers must pass `null` in that case. Supplied
ownership is replayed with explicit `provided` provenance; modeled ownership is
labeled `estimated`, and the label must match `settings.ownershipMode`. Strategy
settings have their own required pre-lock `settingsAsOf` timestamp. This also
places ownership overrides under the snapshot's pre-lock audit boundary;
active overrides without archived ownership provenance are rejected. The benchmark
rejects data paired with missing, post-capture, or invented provenance.
The report repeats projection/settings as-of times and labels ownership
`provided`, `estimated`, or `unavailable`.

Run a real snapshot without networking or database writes:

```sh
npx tsx scripts/validate-nfl-portfolio.ts --input snapshot.json --output report.json
```

An input can be the snapshot itself or `{ "snapshot": ..., "count": 100 }`.
The harness caps portfolio size and gives both arms the same pool, count,
constraints, starting seed, attempt cap, and separate half-of-total runtime
budget. The baseline uses deterministic seeded projection perturbations and
keeps only unique solver outputs; it never pads results with duplicate lineups.
It compares that current-solver baseline (portfolio preset off) with
`generateNflPortfolio`. It reports each arm's attempts, effective output count,
and partial status along with target attainment,
lineup diversity, and actual-point mean, best, and 90th percentile. Missing
actuals produce an explicit `insufficient-data` report rather than a performance
result.

Reports identify the protocol and baseline algorithm versions. CLI reports also
contain SHA-256 fingerprints of the validation harness, portfolio engine,
solver source, and shared contract, so a later implementation change is visible
instead of implying that the implementation itself is immutable. The CLI
disables `fetch` before loading the solver; replay cannot query a current API.

No historical pre-lock dataset is currently bundled. Synthetic unit fixtures
test mechanics only and are never labeled historical evidence. This code cannot
establish profitability. ROI claims require actual contest entries, ranks,
fees, and payouts, none of which this format supplies.