"use client";

// TanStack Query hooks — the caching/refetch layer over the typed client.
// Replaces hand-rolled useEffect poll loops as pages migrate.

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { api, CoachingResponse, StratStatus } from "./client";

export function useRoundTelemetry(matchId: string | null, round: number) {
  return useQuery({
    queryKey: ["telemetry", matchId, round],
    queryFn: () => api.roundTelemetry(matchId as string, round),
    enabled: Boolean(matchId) && round > 0,
    staleTime: Infinity, // a parsed round never changes
  });
}

export function useCoaching(matchId: string | null) {
  return useQuery({
    queryKey: ["coaching", matchId],
    queryFn: () => api.coaching(matchId as string),
    enabled: Boolean(matchId),
    // Poll while the report is cooking; stop once it's ready.
    refetchInterval: (query) =>
      (query.state.data as CoachingResponse | undefined)?.status === "ready" ? false : 5000,
  });
}

export function useStrats(teamId: string | null) {
  return useQuery({
    queryKey: ["strats", teamId],
    queryFn: () => api.strats(teamId as string),
    enabled: Boolean(teamId),
    refetchInterval: 15000, // picks up Discord-side approvals/revisions
  });
}

export function useStratTransition(teamId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ stratId, status }: { stratId: string; status: StratStatus }) =>
      api.stratTransition(stratId, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["strats", teamId] }),
  });
}

export function useCheckout() {
  return useMutation({
    mutationFn: (plan: string) => api.checkout(plan),
    onSuccess: (data) => {
      if (data.url) window.location.href = data.url;
    },
  });
}
