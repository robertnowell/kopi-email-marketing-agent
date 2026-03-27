"use client";

import { useMemo } from "react";
import { Loader2, Play, Calendar, Send, Clock } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AgentWeekWithEntries, VersionWithChat } from "@/db/main/agent-service";
import { AgentCampaignCard } from "./agent-campaign-card";
import type { ContentCalendarEntry } from "@/db/main/schema";

type EntryWithVersions = ContentCalendarEntry & {
  versions: VersionWithChat[];
};

interface AgentWeekCardProps {
  week: AgentWeekWithEntries;
  onGenerate: (weekId: string) => void;
  isGenerating: boolean;
  onSchedule?: (weekId: string) => void;
  isScheduling?: boolean;
  onEntryClick?: (entry: EntryWithVersions) => void;
  brandColor?: string;
}

const STATUS_CONFIG: Record<
  string,
  { label: string; className: string }
> = {
  planning: { label: "Planning", className: "bg-[#1e3a5f]/10 text-[#1e3a5f] border-[#1e3a5f]/20" },
  ideas_selected: { label: "Ideas Selected", className: "bg-[#1e3a5f]/10 text-[#1e3a5f] border-[#1e3a5f]/20" },
  generating: { label: "Generating...", className: "bg-amber-50 text-amber-700 border-amber-200" },
  generated: { label: "Generated", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  reviewing: { label: "Reviewing", className: "bg-[#1e3a5f]/10 text-[#1e3a5f] border-[#1e3a5f]/20" },
  approved: { label: "Approved", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  scheduling: { label: "Scheduling...", className: "bg-amber-50 text-amber-700 border-amber-200" },
  scheduled: { label: "Scheduled", className: "bg-[#1e3a5f] text-white border-[#1e3a5f]" },
  sent: { label: "Sent", className: "bg-[#1e3a5f] text-white border-[#1e3a5f]" },
  error: { label: "Error", className: "bg-red-50 text-red-700 border-red-200" },
};

function formatWeekOf(dateValue: Date | string): string {
  const date = typeof dateValue === "string" ? new Date(dateValue) : dateValue;
  return `Week of ${date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
}

/** The Sunday before the week starts (weekOf is Monday) */
function getCronDate(weekOf: Date | string): string {
  const d = typeof weekOf === "string" ? new Date(weekOf) : new Date(weekOf);
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function getBestScore(entry: EntryWithVersions): number {
  const winner = entry.versions.find((v) => v.isSelected);
  if (winner?.critiqueScore != null) return winner.critiqueScore;
  const scored = entry.versions.filter((v) => v.critiqueScore != null);
  if (scored.length === 0) return -1;
  return Math.max(...scored.map((v) => v.critiqueScore!));
}

function CronHint({ weekOf, label }: { weekOf: Date | string; label: string }) {
  const cronDate = getCronDate(weekOf);
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1 text-xs text-[#1e3a5f]/35 cursor-default">
            <Clock className="h-3 w-3" />
            {cronDate}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[220px] text-center">
          <p className="text-xs">Autopilot will {label} automatically on {cronDate}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function AgentWeekCard({
  week,
  onGenerate,
  isGenerating,
  onSchedule,
  isScheduling,
  onEntryClick,
  brandColor,
}: AgentWeekCardProps) {
  const statusConfig = STATUS_CONFIG[week.status] ?? {
    label: week.status,
    className: "bg-gray-100 text-gray-700 border-gray-200",
  };

  // Determine if this is a scheduling error (entries have scores) vs generation error
  const hasGeneratedEntries = week.entries.some((e) =>
    e.versions.some((v) => v.critiqueScore != null)
  );
  const isScheduleError = week.status === "error" && hasGeneratedEntries;
  const isGenerateError = week.status === "error" && !hasGeneratedEntries;

  const canGenerate =
    week.status === "ideas_selected" ||
    isGenerateError ||
    week.status === "planning";

  const canSchedule =
    week.status === "generated" ||
    week.status === "approved" ||
    week.status === "reviewing" ||
    isScheduleError;

  const isActivelyGenerating = week.status === "generating";
  const isActivelyScheduling = week.status === "scheduling";

  // Sort entries: selected-for-send first, then by score desc
  const sortedEntries = useMemo(() => {
    return [...week.entries].sort((a, b) => {
      if (a.isSelectedForSend && !b.isSelectedForSend) return -1;
      if (!a.isSelectedForSend && b.isSelectedForSend) return 1;
      return getBestScore(b) - getBestScore(a);
    });
  }, [week.entries]);

  const btnStyle = brandColor
    ? { backgroundColor: brandColor }
    : undefined;
  const btnClass = brandColor
    ? "flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
    : "flex items-center gap-2 rounded-lg bg-[#1e3a5f] px-3.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#2a4a72] disabled:opacity-50";

  return (
    <div className="rounded-xl border border-[#1e3a5f]/10 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1e3a5f]/5">
            <Calendar className="h-4 w-4 text-[#1e3a5f]" />
          </div>
          <h3 className="font-semibold text-[#1e3a5f]">{formatWeekOf(week.weekOf)}</h3>
          <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusConfig.className}`}>
            {isActivelyGenerating && (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            )}
            {statusConfig.label}
          </span>
          <span className="text-sm text-[#1e3a5f]/40">
            {week.entries.length} campaign{week.entries.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {canGenerate && (
            <>
              <CronHint weekOf={week.weekOf} label="generate" />
              <button
                className={btnClass}
                style={btnStyle}
                onClick={() => onGenerate(week.id)}
                disabled={isGenerating}
              >
                {isGenerating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                Generate All
              </button>
            </>
          )}
          {canSchedule && (
            <>
              <CronHint weekOf={week.weekOf} label="schedule" />
              <button
                className={btnClass}
                style={btnStyle}
                onClick={() => onSchedule?.(week.id)}
                disabled={isScheduling}
              >
                {isScheduling ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                {isScheduleError ? "Retry Schedule" : `Schedule Top ${week.sendCount}`}
              </button>
            </>
          )}
          {isActivelyScheduling && (
            <span className="flex items-center gap-1.5 text-sm" style={brandColor ? { color: brandColor } : { color: "#ef7c4a" }}>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Scheduling...
            </span>
          )}
        </div>
      </div>

      {sortedEntries.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {sortedEntries.map((entry) => (
            <AgentCampaignCard
              key={entry.id}
              entry={entry}
              onClick={() => onEntryClick?.(entry)}
              brandColor={brandColor}
              deEmphasized={!entry.isSelectedForSend && sortedEntries.some((e) => e.isSelectedForSend)}
            />
          ))}
        </div>
      )}

      {week.errorMessage && (
        <p className="mt-2 text-sm text-red-600">{week.errorMessage}</p>
      )}
    </div>
  );
}
