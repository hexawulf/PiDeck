import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

/** Refetch every query currently on screen (auth excluded). */
export function useRefreshAll() {
  const queryClient = useQueryClient();
  return useCallback(
    () =>
      queryClient.invalidateQueries({
        refetchType: "active",
        predicate: (q) => q.queryKey[0] !== "/api/auth/me",
      }),
    [queryClient],
  );
}
