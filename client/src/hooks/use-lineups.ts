import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";

export function useLineups() {
  return useQuery({
    queryKey: [api.lineups.list.path],
    queryFn: async () => {
      const res = await fetch(api.lineups.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch lineups");
      return api.lineups.list.responses[200].parse(await res.json());
    },
  });
}

export function useDeleteLineup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const url = buildUrl(api.lineups.delete.path, { id });
      const res = await fetch(url, { 
        method: api.lineups.delete.method,
        credentials: "include" 
      });
      if (res.status === 404) throw new Error("Lineup not found");
      if (!res.ok) throw new Error("Failed to delete lineup");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [api.lineups.list.path] }),
  });
}
