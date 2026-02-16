import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type OptimizationConstraints, type InsertLineup } from "@shared/routes";

export function useOptimize() {
  return useMutation({
    mutationFn: async (constraints: OptimizationConstraints) => {
      const res = await fetch(api.optimizer.optimize.path, {
        method: api.optimizer.optimize.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(constraints),
        credentials: "include",
      });
      
      if (!res.ok) {
        if (res.status === 400) {
           const error = api.optimizer.optimize.responses[400].parse(await res.json());
           throw new Error(error.message);
        }
        if (res.status === 500) {
           const error = api.optimizer.optimize.responses[500].parse(await res.json());
           throw new Error(error.message);
        }
        throw new Error("Optimization failed");
      }
      return api.optimizer.optimize.responses[200].parse(await res.json());
    },
  });
}

export function useSaveLineup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (lineupData: InsertLineup) => {
      const res = await fetch(api.lineups.create.path, {
        method: api.lineups.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lineupData),
        credentials: "include",
      });

      if (!res.ok) {
         if (res.status === 400) {
           const error = api.lineups.create.responses[400].parse(await res.json());
           throw new Error(error.message);
         }
         throw new Error("Failed to save lineup");
      }
      return api.lineups.create.responses[201].parse(await res.json());
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [api.lineups.list.path] }),
  });
}
