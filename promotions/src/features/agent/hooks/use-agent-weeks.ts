import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { AgentWeekWithEntries } from "@/db/main/agent-service";

interface AgentWeeksResponse {
  weeks: AgentWeekWithEntries[];
}

export function useAgentWeeks(brandId: string | null) {
  const queryClient = useQueryClient();

  const weeksQuery = useQuery<AgentWeeksResponse>({
    queryKey: ["agent-weeks", brandId],
    queryFn: async () => {
      const res = await fetch(`/api/agent/weeks?brandId=${brandId}`);
      if (!res.ok) throw new Error("Failed to fetch agent weeks");
      return res.json();
    },
    enabled: !!brandId,
    refetchInterval: (query) => {
      // Poll at 3s when any week is generating
      const data = query.state.data;
      const isGenerating = data?.weeks?.some(
        (w) => w.status === "generating"
      );
      return isGenerating ? 3000 : false;
    },
  });

  const createWeekMutation = useMutation({
    mutationFn: async (input: { brandId: string; weekOf?: string }) => {
      const res = await fetch("/api/agent/weeks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create week");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-weeks", brandId] });
    },
  });

  const generateWeekMutation = useMutation({
    mutationFn: async (weekId: string) => {
      const res = await fetch(`/api/agent/weeks/${weekId}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Generation failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-weeks", brandId] });
    },
  });

  const scheduleWeekMutation = useMutation({
    mutationFn: async (weekId: string) => {
      const res = await fetch(`/api/agent/weeks/${weekId}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Scheduling failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-weeks", brandId] });
    },
  });

  return {
    weeks: weeksQuery.data?.weeks ?? [],
    isLoading: weeksQuery.isLoading,
    error: weeksQuery.error,
    createWeek: createWeekMutation.mutate,
    isCreating: createWeekMutation.isPending,
    generateWeek: generateWeekMutation.mutate,
    isGenerating: generateWeekMutation.isPending,
    scheduleWeek: scheduleWeekMutation.mutate,
    isScheduling: scheduleWeekMutation.isPending,
    refetch: weeksQuery.refetch,
  };
}
