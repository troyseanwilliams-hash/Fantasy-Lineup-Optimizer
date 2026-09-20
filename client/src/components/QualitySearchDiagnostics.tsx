export interface QualitySearchDiagnosticsData {
  baselineProjection: number;
  baselineStatus?: "best_found";
  relativeThreshold?: number;
  effectiveFloor: number;
  candidatesConsidered: number;
  qualifiedCandidates: number;
  uniqueVariants: number;
  requestedCount: number;
  generatedCount: number;
  stoppingReason: string;
  projectionRange: { min: number; max: number } | null;
}

function points(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : "Unavailable";
}

function stoppingReason(value: string): string {
  const labels: Record<string, string> = {
    candidate_budget: "candidate search budget reached",
    time_budget: "time budget reached",
    requested_count: "requested lineup count reached",
    exhausted: "eligible candidates exhausted",
  };
  return labels[value] ?? value.replaceAll("_", " ");
}

export function QualitySearchDiagnostics({
  diagnostics,
  partial = false,
  mode = "projection",
  className = "",
  testId = "quality-search-diagnostics",
}: {
  diagnostics?: QualitySearchDiagnosticsData | null;
  partial?: boolean;
  mode?: "projection" | "sim";
  className?: string;
  testId?: string;
}) {
  if (!diagnostics) return null;

  const isPartial = partial || diagnostics.generatedCount < diagnostics.requestedCount;
  const threshold = typeof diagnostics.relativeThreshold === "number" && Number.isFinite(diagnostics.relativeThreshold)
    ? `${Math.round(diagnostics.relativeThreshold * 100)}% of the best projection found`
    : "the effective projected-points floor";

  return (
    <section
      className={`rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-slate-300 space-y-1.5 ${className}`}
      data-testid={testId}
      aria-label="Quality-first lineup search diagnostics"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-amber-300">Quality-first search</h3>
        {isPartial && (
          <span className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-bold text-amber-200">
            Partial results
          </span>
        )}
      </div>
      {isPartial && (
        <p className="font-medium text-amber-200" role="status">
          Returned {diagnostics.generatedCount} of {diagnostics.requestedCount} requested lineups. Every returned lineup passed the displayed deterministic projection floor.
        </p>
      )}
      <p>
        <strong className="text-slate-100">{diagnostics.candidatesConsidered}</strong> unique candidates considered ·{" "}
        <strong className="text-slate-100">{diagnostics.qualifiedCandidates}</strong> qualified ·{" "}
        <strong className="text-slate-100">{diagnostics.uniqueVariants}</strong> unique variants returned
      </p>
      <p>
        Deterministic projected-points eligibility: at least <strong className="text-slate-100">{points(diagnostics.effectiveFloor)}</strong>{" "}
        ({threshold}).
      </p>
      <p>
        Best projection found: <strong className="text-slate-100">{points(diagnostics.baselineProjection)}</strong>. This is not a guaranteed win or proof of mathematical optimality.
      </p>
      <p>
        Eligible projection range:{" "}
        {diagnostics.projectionRange
          ? <strong className="text-slate-100">{points(diagnostics.projectionRange.min)}–{points(diagnostics.projectionRange.max)}</strong>
          : <strong className="text-slate-100">No qualified candidates</strong>}
      </p>
      {mode === "sim" && (
        <p className="text-violet-200">
          Simulation upside metrics rank the qualified candidates separately; they do not replace the deterministic projected-points eligibility rule.
        </p>
      )}
      <p>Search stopped because the {stoppingReason(diagnostics.stoppingReason)}.</p>
    </section>
  );
}