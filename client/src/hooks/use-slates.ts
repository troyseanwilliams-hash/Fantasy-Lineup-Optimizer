import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl, type InsertSlate, type InsertPlayer } from "@shared/routes";

export function useSlates() {
  return useQuery({
    queryKey: [api.slates.list.path],
    queryFn: async () => {
      const res = await fetch(api.slates.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch slates");
      return api.slates.list.responses[200].parse(await res.json());
    },
  });
}

export function useCreateSlate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: InsertSlate) => {
      const res = await fetch(api.slates.create.path, {
        method: api.slates.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) {
        if (res.status === 400) {
          const error = api.slates.create.responses[400].parse(await res.json());
          throw new Error(error.message);
        }
        throw new Error("Failed to create slate");
      }
      return api.slates.create.responses[201].parse(await res.json());
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [api.slates.list.path] }),
  });
}

export function useSlatePlayers(slateId: number) {
  return useQuery({
    queryKey: [api.slates.getPlayers.path, slateId],
    queryFn: async () => {
      const url = buildUrl(api.slates.getPlayers.path, { id: slateId });
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch players for slate");
      return api.slates.getPlayers.responses[200].parse(await res.json());
    },
    enabled: !!slateId,
  });
}

export function useBulkCreatePlayers() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ slateId, players }: { slateId: number, players: InsertPlayer[] }) => {
      const url = buildUrl(api.players.bulkCreate.path, { id: slateId });
      const res = await fetch(url, {
        method: api.players.bulkCreate.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(players),
        credentials: "include",
      });
      if (!res.ok) {
         if (res.status === 400) {
          const error = api.players.bulkCreate.responses[400].parse(await res.json());
          throw new Error(error.message);
        }
        throw new Error("Failed to bulk upload players");
      }
      return api.players.bulkCreate.responses[201].parse(await res.json());
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [api.slates.getPlayers.path, variables.slateId] });
    },
  });
}
