import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, Check, ChevronDown, CircleAlert, Loader2, Plus, Sparkles, Star, Trash2, Users } from "lucide-react";
import { useSlates, useSlatePlayers } from "@/hooks/use-slates";
import { FavoriteStack, useCreateFavoriteStack, useDeleteFavoriteStack, useFavoriteStacks } from "@/hooks/use-favorite-stacks";

type Player = { id: number; name: string; team: string; opponent?: string | null; position: string; projection?: number | string | null; projectedPoints?: number | string | null; gameInfo?: string | null; gameKey?: string | null };
type SlateLike = { id: number; name?: string; sport?: string; platform?: string; isMain?: boolean; gameType?: string };
type Game = { key: string; label: string; teams: string[]; players: Player[]; projection: number };

const points = (player: Player) => Number(player.projection ?? player.projectedPoints ?? 0);
const isClassic = (slate: SlateLike) => String(slate.gameType ?? "Classic").toLowerCase() === "classic";
const STACKABLE_SPORTS = new Set(["NFL", "NBA", "MLB", "NHL", "SOCCER"]);
const isStackableSlate = (slate: SlateLike) => isClassic(slate) && STACKABLE_SPORTS.has(String(slate.sport ?? "").toUpperCase());
const displayPosition = (position: string) => position.split("/")[0] || "UTIL";

export default function TopStacks() {
  const [, navigate] = useLocation();
  const params = new URLSearchParams(window.location.search);
  const slateIdFromUrl = Number(params.get("slateId")) || undefined;
  const { data: allSlates, isLoading: slatesLoading } = useSlates();
  const classicSlates = useMemo(() => ((allSlates ?? []) as SlateLike[]).filter(isStackableSlate), [allSlates]);
  const [slateId, setSlateId] = useState<number | undefined>(slateIdFromUrl);
  const selectedSlate = classicSlates.find((slate) => slate.id === slateId);

  useEffect(() => {
    if (slateIdFromUrl && classicSlates.some((slate) => slate.id === slateIdFromUrl)) setSlateId(slateIdFromUrl);
    else if (!slateId && classicSlates[0]) setSlateId((classicSlates.find((slate) => slate.sport === "NFL") ?? classicSlates[0]).id);
  }, [classicSlates, slateId, slateIdFromUrl]);

  const { data: rawPlayers, isLoading: playersLoading, error: playersError } = useSlatePlayers(slateId ?? 0);
  const players = (rawPlayers ?? []) as unknown as Player[];
  const games = useMemo<Game[]>(() => {
    const grouped = new Map<string, Player[]>();
    players.forEach((player) => {
      const gameKey = player.gameKey || player.gameInfo || [player.team, player.opponent].filter(Boolean).sort().join(" @ ");
      if (!gameKey || !player.team) return;
      grouped.set(gameKey, [...(grouped.get(gameKey) ?? []), player]);
    });
    return Array.from(grouped.entries()).map(([key, gamePlayers]: [string, Player[]]) => {
      const teams = Array.from(new Set<string>(gamePlayers.map((player: Player) => player.team)));
      const matchupKey = [...teams].sort().join("-");
      return { key: matchupKey, teams, players: gamePlayers.sort((a: Player, b: Player) => points(b) - points(a)), label: `${teams[0]} @ ${teams[1]}`, projection: gamePlayers.reduce((sum: number, player: Player) => sum + points(player), 0) };
    }).filter((game) => game.teams.length === 2 && game.key.length > 2).sort((a, b) => b.projection - a.projection);
  }, [players]);

  const { data: favorites = [], isLoading: favoritesLoading, error: favoritesError } = useFavoriteStacks(slateId);
  const createFavorite = useCreateFavoriteStack(slateId);
  const deleteFavorite = useDeleteFavoriteStack(slateId);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [builderGameKey, setBuilderGameKey] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setSelectedIds([]);
    setBuilderGameKey("");
  }, [slateId]);

  const suggested = useMemo(() => games.map((game) => {
    const qb = game.players.find((player) => displayPosition(player.position) === "QB");
    const sameTeamTargets = qb ? game.players.filter((player) => player.team === qb.team && ["WR", "TE"].includes(displayPosition(player.position))) : [];
    const opponentSkill = qb ? game.players.find((player) => player.team !== qb.team && ["WR", "TE", "RB"].includes(displayPosition(player.position))) : undefined;
    const picked = [qb, ...sameTeamTargets.slice(0, 2), opponentSkill].filter(Boolean) as Player[];
    return { game, players: picked.length >= 2 ? picked.slice(0, 4) : game.players.slice(0, 3) };
  }).filter((item) => item.players.length >= 2).sort((a, b) => b.players.reduce((sum, player) => sum + points(player), 0) - a.players.reduce((sum, player) => sum + points(player), 0)).slice(0, 8), [games]);

  const save = (stack: Omit<FavoriteStack, "id" | "slateId">) => {
    createFavorite.mutate(stack, { onSuccess: () => setNotice(`Saved ${stack.name}. It is ready for Sim.`), onError: (error) => setNotice(error.message) });
  };
  const builderGame = games.find((game) => game.key === builderGameKey);
  const builderPlayers = builderGame?.players.filter((player) => selectedIds.includes(player.id)) ?? [];
  const togglePlayer = (player: Player) => setSelectedIds((current) => current.includes(player.id) ? current.filter((id) => id !== player.id) : current.length < 5 ? [...current, player.id] : current);
  const favoritedGameKeys = new Set(favorites.filter((item) => item.kind === "game").map((item) => item.gameKey));
  const favoritedPlayerSets = new Set(favorites.filter((item) => item.kind === "players").map((item) => [...item.playerIds].sort((a, b) => a - b).join(",")));

  return <div className="min-h-[100dvh] bg-[#0F172A] text-slate-100">
    <section className="border-b border-slate-800 bg-[radial-gradient(circle_at_15%_0%,rgba(16,185,129,.16),transparent_35%),#0F172A]">
      <div className="container mx-auto px-4 py-10 md:py-14">
        <div className="flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 flex items-center gap-2 text-[11px] font-black uppercase tracking-[.22em] text-emerald-400"><Sparkles className="h-4 w-4" /> Correlation desk</div>
            <h1 className="text-4xl font-black tracking-tight text-white md:text-6xl">Top Stacks</h1>
            <p className="mt-4 max-w-xl text-base leading-7 text-slate-400">Choose the games and exact player correlations you want the optimizer to respect. Rankings are summed player projections — not odds or simulation outcomes.</p>
          </div>
          <label className="block lg:w-80"><span className="mb-2 block text-[11px] font-black uppercase tracking-widest text-slate-500">Classic slate</span>
            <div className="relative"><select value={slateId ?? ""} onChange={(event) => { const id = Number(event.target.value); setSlateId(id); navigate(`/top-stacks?slateId=${id}`); }} className="h-12 w-full appearance-none rounded-xl border border-slate-700 bg-slate-900 px-4 pr-10 text-sm font-bold text-white outline-none focus:border-emerald-500" disabled={slatesLoading}>
              {classicSlates.map((slate) => <option key={slate.id} value={slate.id}>{slate.sport} · {slate.name || `${slate.platform} slate`}</option>)}
            </select><ChevronDown className="pointer-events-none absolute right-3 top-3.5 h-5 w-5 text-slate-400" /></div>
          </label>
        </div>
      </div>
    </section>

    <main className="container mx-auto px-4 py-8 md:py-10">
      {notice && <div className="mb-6 flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-bold text-emerald-300"><span>{notice}</span><button onClick={() => setNotice("")} className="text-emerald-300">Dismiss</button></div>}
      {!slatesLoading && !slateId && <Empty title="No classic slates available" detail="Top Stacks is available when a classic slate is on the board." />}
      {slateId && <div className="grid gap-8 xl:grid-cols-[1fr_360px]">
        <div className="space-y-8">
          <SectionTitle eyebrow="01 / Game environment" title="Favorite a game" detail="Ranked by total available projection across players in each game." />
          {playersLoading ? <SkeletonRows /> : playersError ? <ErrorState /> : games.length === 0 ? <Empty title="No games found on this slate" detail="Player game assignments have not been published yet." /> :
            <div className="grid gap-3">{games.map((game, index) => <div key={game.key} className="rounded-2xl border border-slate-800 bg-slate-900/65 p-4 transition-colors hover:border-slate-700 md:flex md:items-center md:gap-5">
              <div className="flex min-w-0 flex-1 items-center gap-4"><span className="w-7 text-center font-mono text-sm font-black text-slate-500">{String(index + 1).padStart(2, "0")}</span><div className="min-w-0"><div className="font-black text-white">{game.label}</div><div className="mt-1 text-xs text-slate-500">{game.players.length} players · summed projection</div></div></div>
              <div className="mt-4 flex items-center justify-between gap-4 md:mt-0"><div><div className="text-right text-xl font-black text-emerald-400">{game.projection.toFixed(1)}</div><div className="text-right text-[10px] font-bold uppercase tracking-wider text-slate-500">Proj. sum</div></div>
              <button onClick={() => save({ kind: "game", name: game.label, gameKey: game.key, playerIds: [] })} disabled={favoritedGameKeys.has(game.key) || createFavorite.isPending} className="inline-flex h-10 items-center gap-2 rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-3 text-xs font-black text-emerald-300 disabled:cursor-default disabled:opacity-60">{favoritedGameKeys.has(game.key) ? <Check className="h-4 w-4" /> : <Star className="h-4 w-4" />}{favoritedGameKeys.has(game.key) ? "Saved" : "Favorite"}</button></div>
            </div>)}</div>}
          <SectionTitle eyebrow="02 / Exact correlations" title="Suggested player stacks" detail="Projection-led combinations from the same game. NFL suggestions prioritize QB + same-team WR/TE, with an optional opposing skill player." />
          {playersLoading ? <SkeletonRows /> : <div className="grid gap-3 md:grid-cols-2">{suggested.map(({ game, players: combo }) => { const ids = combo.map((player) => player.id); const saved = favoritedPlayerSets.has([...ids].sort((a, b) => a - b).join(",")); const total = combo.reduce((sum, player) => sum + points(player), 0); return <article key={`${game.key}-${ids.join("-")}`} className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><div className="mb-4 flex items-start justify-between gap-3"><div><div className="text-[10px] font-black uppercase tracking-[.18em] text-emerald-400">{game.label}</div><div className="mt-1 text-sm font-bold text-slate-400">{total.toFixed(1)} summed projection</div></div><button onClick={() => save({ kind: "players", name: combo.map((player) => player.name).join(" + "), gameKey: game.key, playerIds: ids })} disabled={saved || createFavorite.isPending} className="rounded-lg p-2 text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-50" aria-label="Save player stack">{saved ? <Check className="h-5 w-5" /> : <Star className="h-5 w-5" />}</button></div><div className="space-y-2">{combo.map((player) => <div key={player.id} className="flex items-center justify-between text-sm"><span className="min-w-0 truncate font-bold text-slate-200">{player.name}</span><span className="ml-3 rounded bg-slate-800 px-2 py-0.5 font-mono text-[11px] text-slate-400">{displayPosition(player.position)} · {points(player).toFixed(1)}</span></div>)}</div></article>; })}</div>}
        </div>
        <aside className="space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-[#172238] p-5">
            <div className="mb-1 flex items-center gap-2"><Plus className="h-4 w-4 text-emerald-400" /><h2 className="font-black text-white">Build an exact stack</h2></div><p className="mb-5 text-xs leading-5 text-slate-400">Select 2–5 unique players from one game. Your choices persist to this slate.</p>
            <select value={builderGameKey} onChange={(event) => { setBuilderGameKey(event.target.value); setSelectedIds([]); }} className="mb-3 h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm font-bold text-slate-200 outline-none focus:border-emerald-500"><option value="">Choose a game</option>{games.map((game) => <option key={game.key} value={game.key}>{game.label}</option>)}</select>
            {builderGame && <div className="mb-4 max-h-64 space-y-1 overflow-y-auto pr-1">{builderGame.players.map((player) => <label key={player.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-800"><input type="checkbox" checked={selectedIds.includes(player.id)} onChange={() => togglePlayer(player)} disabled={!selectedIds.includes(player.id) && selectedIds.length >= 5} className="accent-emerald-500" /><span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-300">{player.name}</span><span className="font-mono text-[10px] text-slate-500">{displayPosition(player.position)} · {points(player).toFixed(1)}</span></label>)}</div>}
            <button onClick={() => save({ kind: "players", name: builderPlayers.map((player) => player.name).join(" + "), gameKey: builderGameKey, playerIds: selectedIds })} disabled={selectedIds.length < 2 || createFavorite.isPending} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 text-sm font-black text-slate-950 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"><Star className="h-4 w-4" /> Save {selectedIds.length ? `${selectedIds.length}-player` : ""} stack</button>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><div className="mb-4 flex items-center justify-between"><div><div className="text-[10px] font-black uppercase tracking-[.18em] text-emerald-400">Your slate plan</div><h2 className="mt-1 font-black text-white">Favorites</h2></div><span className="rounded-full bg-slate-800 px-2 py-1 text-xs font-black text-slate-400">{favorites.length}</span></div>
            {favoritesLoading ? <div className="space-y-3"><div className="h-12 animate-pulse rounded bg-slate-800" /><div className="h-12 animate-pulse rounded bg-slate-800" /></div> : favoritesError ? <p className="text-sm text-rose-300">Saved stacks could not be loaded.</p> : favorites.length === 0 ? <p className="py-5 text-center text-sm leading-6 text-slate-500">Star a game or save an exact stack to send it to Sim.</p> : <div className="space-y-2">{favorites.map((favorite) => <div key={favorite.id} className="group flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3"><Users className="h-4 w-4 shrink-0 text-emerald-400" /><div className="min-w-0 flex-1"><div className="truncate text-xs font-black text-slate-200">{favorite.name}</div><div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{favorite.kind === "game" ? "Game" : `${favorite.playerIds.length}-player stack`}</div></div><button onClick={() => deleteFavorite.mutate(favorite.id, { onError: (error) => setNotice(error.message) })} className="p-1 text-slate-500 hover:text-rose-400" aria-label={`Remove ${favorite.name}`}><Trash2 className="h-4 w-4" /></button></div>)}</div>}
            {favorites.length > 0 && selectedSlate && <Link href={`/optimizer-pro/${selectedSlate.id}?useFavoriteStacks=1`} className="mt-5 flex h-11 items-center justify-center gap-2 rounded-lg border border-emerald-500/50 text-sm font-black text-emerald-300 transition-colors hover:bg-emerald-500/10">Use favorites in Sim <ArrowRight className="h-4 w-4" /></Link>}
          </div>
        </aside>
      </div>}
    </main>
  </div>;
}

function SectionTitle({ eyebrow, title, detail }: { eyebrow: string; title: string; detail: string }) { return <div><div className="text-[10px] font-black uppercase tracking-[.2em] text-emerald-400">{eyebrow}</div><h2 className="mt-1 text-2xl font-black text-white">{title}</h2><p className="mt-1 text-sm text-slate-500">{detail}</p></div>; }
function SkeletonRows() { return <div className="space-y-3">{[1, 2, 3, 4].map((item) => <div key={item} className="h-20 animate-pulse rounded-2xl bg-slate-800/60" />)}</div>; }
function Empty({ title, detail }: { title: string; detail: string }) { return <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/50 px-6 py-14 text-center"><Users className="mx-auto mb-4 h-7 w-7 text-slate-600" /><h2 className="font-black text-slate-200">{title}</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">{detail}</p></div>; }
function ErrorState() { return <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6"><CircleAlert className="mb-3 h-6 w-6 text-rose-400" /><p className="font-bold text-rose-200">Player data could not be loaded.</p><button onClick={() => window.location.reload()} className="mt-3 text-sm font-bold text-rose-300 underline">Try again</button></div>; }