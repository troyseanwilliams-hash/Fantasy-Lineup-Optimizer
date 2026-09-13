import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface FavoriteStack {
  id: number;
  slateId: number;
  kind: "game" | "players";
  name: string;
  gameKey: string | null;
  playerIds: number[];
}

export function useFavoriteStacks(slateId: number | undefined) {
  return useQuery<FavoriteStack[]>({
    queryKey: [`/api/slates/${slateId}/favorite-stacks`],
    queryFn: async () => {
      const response = await fetch(`/api/slates/${slateId}/favorite-stacks`, { credentials: "include" });
      if (!response.ok) throw new Error("Unable to load saved stacks.");
      const payload: unknown = await response.json();
      return Array.isArray(payload) ? payload : [];
    },
    enabled: !!slateId,
  });
}

export function useCreateFavoriteStack(slateId: number | undefined) {
  const queryClient = useQueryClient();
  const queryKey = [`/api/slates/${slateId}/favorite-stacks`];
  return useMutation({
    mutationFn: async (stack: Omit<FavoriteStack, "id" | "slateId">) => {
      if (!slateId) throw new Error("Select a slate before saving.");
      const response = await fetch(`/api/slates/${slateId}/favorite-stacks`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(stack),
      });
      if (!response.ok) throw new Error("Unable to save stack.");
      return response.json() as Promise<FavoriteStack>;
    },
    onSuccess: (created) => {
      queryClient.setQueryData<FavoriteStack[]>(queryKey, (current = []) => [...current, created]);
    },
  });
}

export function useDeleteFavoriteStack(slateId: number | undefined) {
  const queryClient = useQueryClient();
  const queryKey = [`/api/slates/${slateId}/favorite-stacks`];
  return useMutation({
    mutationFn: async (id: number) => {
      if (!slateId) throw new Error("Select a slate before removing.");
      const response = await fetch(`/api/slates/${slateId}/favorite-stacks/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Unable to remove stack.");
    },
    onSuccess: (_, removedId) => {
      queryClient.setQueryData<FavoriteStack[]>(queryKey, (current = []) => current.filter((item) => item.id !== removedId));
    },
  });
}