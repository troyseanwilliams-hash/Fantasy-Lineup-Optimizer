/**
 * ShowdownBuilder — Slate Selection Patch
 *
 * Apply these changes to ShowdownBuilder.tsx.
 * Only the slate query, state reset helper, and the dropdown need to change.
 * Everything else (player table, optimizer, lineup card) is untouched.
 *
 * CHANGES
 * ───────
 * 1. Slate type extended with new fields returned by the route
 * 2. useQuery for slates: default to the isMain slate, not just last
 * 3. resetForSlate() — one function that resets ALL player-specific state
 *    when the user switches slates so nothing bleeds across slate changes
 * 4. Slate dropdown: shows the server-provided label (e.g.
 *    "Classic · 8 games · 7:05 PM ET") with a star for the main slate
 * 5. Sport switch also calls resetForSlate()
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. Extended slate type  (add alongside existing ShowdownLineup / ShowdownConfig)
// ─────────────────────────────────────────────────────────────────────────────

interface SlateOption {
  id:           number;
  sport:        string;
  platform:     string;
  gameType:     string;
  label:        string;   // "Classic · 8 games · 7:05 PM ET"
  startTime:    string;
  isMain:       boolean;
  gameCount:    number;
  contestCount: number;
  salaryCap:    number;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Replace the existing slates useQuery (around line 84)
// ─────────────────────────────────────────────────────────────────────────────

/*
REMOVE:
  const { data: slates, isLoading: slatesLoading } = useQuery<Slate[]>({
    queryKey: ["/api/showdown/slates", sport],
    queryFn: async () => {
      const res = await fetch(`/api/showdown/slates?sport=${sport}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch slates");
      const data = await res.json();
      if (data.length > 0 && !selectedSlateId) {
        const main = data.find((s: Slate) => s.isMain) || data[data.length - 1];
        setSelectedSlateId(main.id);
      }
      return data;
    },
  });

ADD:
*/
  const { data: slates, isLoading: slatesLoading } = useQuery<SlateOption[]>({
    queryKey: ["/api/showdown/slates", sport, platform],
    queryFn: async () => {
      const res = await fetch(
        `/api/showdown/slates?sport=${sport}&platform=${platform}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to fetch slates");
      const data: SlateOption[] = await res.json();
      // Auto-select: prefer the main Classic slate, then the earliest
      if (data.length > 0 && !selectedSlateId) {
        const main = data.find(s => s.isMain) ?? data[0];
        setSelectedSlateId(main.id);
      }
      return data;
    },
    // Re-fetch if the user comes back to the tab — slates change throughout the day
    refetchOnWindowFocus: true,
    staleTime: 5 * 60 * 1000,  // treat slate list as fresh for 5 min
  });

// ─────────────────────────────────────────────────────────────────────────────
// 3. Add resetForSlate() helper — call this whenever the slate changes
//    Place it near the existing toggleCaptain / toggleFlex functions
// ─────────────────────────────────────────────────────────────────────────────

/*
ADD after the existing useState declarations:
*/
  function resetForSlate(newSlateId: number | null) {
    // Player-specific state that must be cleared when switching slates
    setCaptainId(null);
    setLockedFlexIds([]);
    setExcludedIds([]);
    setGameFilter("");
    setSearchTerm("");
    setPosFilter("ALL");
    setTeamFilter("ALL");
    setSalaryRange(null);
    setCustomProjections({});
    setPlayerSettings({});          // per-player settings (projection, ownership, exposure, fade)
    setExpandedSettingsId(null);
    // Generated lineups belong to the old slate — wipe them
    setGeneratedLineups([]);
    setSavedLineupIndices(new Set());
    setActiveLineupIdx(0);
    setSelectedSlateId(newSlateId);
  }

// ─────────────────────────────────────────────────────────────────────────────
// 4. Replace the sport buttons' onClick (around line 293-300)
// ─────────────────────────────────────────────────────────────────────────────

/*
REMOVE:
  onClick={() => { setSport(s); setSelectedSlateId(null); setGeneratedLineups([]);
                   setCaptainId(null); setLockedFlexIds([]); setExcludedIds([]);
                   setGameFilter(""); }}

ADD:
*/
  onClick={() => { setSport(s); resetForSlate(null); }}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Replace the slate <Select> block (around line 306-321)
// ─────────────────────────────────────────────────────────────────────────────

/*
REMOVE the entire slate Select block and replace with:
*/
          <Select
            value={selectedSlateId?.toString() || ""}
            onValueChange={v => resetForSlate(Number(v))}
          >
            <SelectTrigger
              className="bg-slate-800 border-slate-600 text-white sm:max-w-sm"
              data-testid="select-slate"
            >
              <SelectValue placeholder={slatesLoading ? "Loading slates..." : "Select a slate"} />
            </SelectTrigger>
            <SelectContent>
              {(slates || []).map(s => (
                <SelectItem key={s.id} value={s.id.toString()}>
                  <div className="flex items-center gap-2">
                    {s.isMain && (
                      <span className="text-amber-400 text-[10px] font-black">★</span>
                    )}
                    <span>{s.label}</span>
                    {s.gameCount > 0 && !s.label.includes("game") && (
                      <span className="text-slate-500 text-[11px]">
                        · {s.gameCount}G
                      </span>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

// ─────────────────────────────────────────────────────────────────────────────
// 6. Update the "Select a Slate" empty-state message (around line 350-357)
//    to tell users how many slates are available once loaded
// ─────────────────────────────────────────────────────────────────────────────

/*
REPLACE the empty-state CardContent with:
*/
            <CardContent className="p-12 text-center" data-testid="showdown-select-slate">
              <Swords className="w-16 h-16 text-slate-600 mx-auto mb-4" />
              <h3 className="text-lg font-bold text-white mb-2">Select a Slate</h3>
              <p className="text-slate-400">
                {slates && slates.length > 0
                  ? `${slates.length} ${sport} slate${slates.length > 1 ? "s" : ""} available — pick one above.`
                  : `Choose a ${sport} slate above to start building showdown lineups.`}
              </p>
              {slates && slates.length > 1 && (
                <p className="text-slate-500 text-xs mt-2">
                  ★ marks the main Classic slate
                </p>
              )}
            </CardContent>
