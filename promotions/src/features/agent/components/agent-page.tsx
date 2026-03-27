"use client";

import { useEffect, useMemo, useState } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, Plus, Clock } from "lucide-react";
import { toast } from "sonner";
import { Icons } from "@/components/common/icons";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { useBrands } from "@/features/editor/properties/brands/brand-hooks";
import { useAgentWeeks } from "../hooks/use-agent-weeks";
import { AgentWeekCard } from "./agent-week-card";
import { AgentSentWeekCard, type SentCampaign } from "./agent-sent-week-card";
import { AgentCampaignDetailSheet } from "./agent-campaign-detail-sheet";
import type { ContentCalendarEntry } from "@/db/main/schema";
import type { VersionWithChat } from "@/db/main/agent-service";
import { getMockSentCampaigns } from "../actions/get-mock-sent-week";

/** Next Sunday — when autopilot would create a new week */
function getNextSunday(): string {
  const now = new Date();
  const day = now.getDay();
  const daysUntilSunday = day === 0 ? 7 : 7 - day;
  const sunday = new Date(now);
  sunday.setDate(now.getDate() + daysUntilSunday);
  return sunday.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

type EntryWithVersions = ContentCalendarEntry & {
  versions: VersionWithChat[];
};

export function AgentPage() {
  const { currentBrand, isLoading: isLoadingBrand } = useBrands();
  const brandId = currentBrand?.id ?? null;
  const {
    weeks,
    isLoading,
    createWeek,
    isCreating,
    generateWeek,
    isGenerating,
    scheduleWeek,
    isScheduling,
  } = useAgentWeeks(brandId);

  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Derive selected entry from fresh query data so it updates after mutations
  const selectedEntry = useMemo(() => {
    if (!selectedEntryId) return null;
    for (const week of weeks) {
      const entry = week.entries.find((e) => e.id === selectedEntryId);
      if (entry) return entry;
    }
    return null;
  }, [selectedEntryId, weeks]);

  // Fetch top 2 starred emails for the active brand as mock "sent" week
  const [sentCampaigns, setSentCampaigns] = useState<SentCampaign[]>([]);
  useEffect(() => {
    if (!brandId) {
      setSentCampaigns([]);
      return;
    }
    getMockSentCampaigns(brandId).then(setSentCampaigns).catch(() => setSentCampaigns([]));
  }, [brandId]);

  // Last Monday as the mock sent week date
  const mockSentWeekOf = useMemo(() => {
    const now = new Date();
    const d = new Date(now);
    d.setDate(now.getDate() - ((now.getDay() + 6) % 7) - 7);
    return d;
  }, []);

  // Reverse so latest week appears at the bottom
  const sortedWeeks = useMemo(
    () => [...weeks].reverse(),
    [weeks]
  );

  const handleCreateWeek = () => {
    if (!brandId) return;
    createWeek(
      { brandId },
      {
        onSuccess: () => toast.success("Agent week created"),
        onError: (e) => toast.error(e.message),
      }
    );
  };

  const handleGenerate = (weekId: string) => {
    generateWeek(weekId, {
      onSuccess: () => toast.success("Generation started"),
      onError: (e) => toast.error(e.message),
    });
  };

  const handleSchedule = (weekId: string) => {
    scheduleWeek(weekId, {
      onSuccess: (data: any) =>
        toast.success(`${data.scheduled} campaign(s) pushed to Klaviyo`),
      onError: (e) => toast.error(e.message),
    });
  };

  const handleEntryClick = (entry: EntryWithVersions) => {
    setSelectedEntryId(entry.id);
    setSheetOpen(true);
  };

  return (
    <div className="flex w-full flex-1 flex-col">
      {/* Toolbar row */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-[#1e3a5f]/10 bg-white px-4">
        <SidebarTrigger className="-ml-1" />
        <div className="flex items-center gap-2.5 ml-1">
          {currentBrand && (currentBrand.logo || currentBrand.header?.logo?.src) ? (
            <img
              src={currentBrand.logo || currentBrand.header?.logo?.src}
              alt={currentBrand.brandName}
              className="h-7 w-7 rounded-md object-contain"
            />
          ) : (
            <Icons.logo className="h-7 w-auto" />
          )}
          <div className="flex items-baseline gap-1.5">
            <h1 className="text-base font-semibold text-[#1e3a5f] tracking-tight">
              {currentBrand?.brandName ?? "Kopi AI"}
            </h1>
            <span className="text-base text-[#1e3a5f]/50 font-normal">Agent</span>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center gap-1 text-xs text-[#1e3a5f]/35 cursor-default">
                  <Clock className="h-3 w-3" />
                  {getNextSunday()}
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[220px] text-center">
                <p className="text-xs">Autopilot will create a new week automatically on {getNextSunday()}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <button
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:opacity-90 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: currentBrand?.colors?.primary ?? "#ef7c4a" }}
            onClick={handleCreateWeek}
            disabled={isCreating || !brandId}
          >
            {isCreating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            New Week
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto bg-[#f0f4f8] p-5">
        {isLoadingBrand || isLoading ? (
          <div className="space-y-4">
            {[1, 2].map((i) => (
              <Skeleton key={i} className="h-48 w-full rounded-xl" />
            ))}
          </div>
        ) : !brandId ? (
          <div className="flex h-64 items-center justify-center text-[#1e3a5f]/50">
            Select a brand to get started
          </div>
        ) : (
          <div className="space-y-4">
            {/* Previous sent week — real emails, mock performance */}
            {sentCampaigns.length > 0 && (
              <AgentSentWeekCard
                weekOf={mockSentWeekOf}
                campaigns={sentCampaigns}
              />
            )}

            {/* Active weeks */}
            {sortedWeeks.map((week) => (
              <AgentWeekCard
                key={week.id}
                week={week}
                onGenerate={handleGenerate}
                isGenerating={isGenerating}
                onSchedule={handleSchedule}
                isScheduling={isScheduling}
                onEntryClick={handleEntryClick}
                brandColor={currentBrand?.colors?.primary}
              />
            ))}
          </div>
        )}
      </div>

      <AgentCampaignDetailSheet
        entry={selectedEntry}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        brandId={brandId ?? ""}
      />
    </div>
  );
}
