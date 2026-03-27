"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Check, ExternalLink, Trophy, Star, StarOff } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import type { ContentCalendarEntry } from "@/db/main/schema";
import type { VersionWithChat } from "@/db/main/agent-service";

type EntryWithVersions = ContentCalendarEntry & {
  versions: VersionWithChat[];
};

interface AgentCampaignDetailSheetProps {
  entry: EntryWithVersions | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brandId: string;
}

function getLetterGrade(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

function getScoreColor(score: number): string {
  if (score >= 80) return "text-emerald-700 bg-emerald-50 border-emerald-200";
  if (score >= 60) return "text-amber-700 bg-amber-50 border-amber-200";
  return "text-red-700 bg-red-50 border-red-200";
}

export function AgentCampaignDetailSheet({
  entry,
  open,
  onOpenChange,
  brandId,
}: AgentCampaignDetailSheetProps) {
  const queryClient = useQueryClient();

  if (!entry) return null;

  const emailPlan = entry.emailPlan as {
    hook?: string;
    graphic?: string;
    offer?: string;
    context?: string;
  } | null;

  const versionA = entry.versions.find((v) => v.versionLabel === "A");
  const versionB = entry.versions.find((v) => v.versionLabel === "B");
  const isMarkedForSend = entry.isSelectedForSend === true;

  const handleToggleSend = async () => {
    try {
      const res = await fetch(`/api/agent/campaigns/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isSelectedForSend: !isMarkedForSend }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update");
      }
      toast.success(isMarkedForSend ? "Removed from send list" : "Marked for send");
      queryClient.invalidateQueries({ queryKey: ["agent-weeks", brandId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update");
    }
  };

  const handleSelectVersion = async (versionId: string) => {
    try {
      const res = await fetch(`/api/agent/campaigns/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedVersionId: versionId }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to select version");
      }
      toast.success("Version selected");
      queryClient.invalidateQueries({ queryKey: ["agent-weeks", brandId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to select version");
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto px-6">
        <SheetHeader>
          <SheetTitle className="text-lg">{entry.title}</SheetTitle>
          {entry.ideaText && (
            <SheetDescription className="line-clamp-3">
              {entry.ideaText}
            </SheetDescription>
          )}
        </SheetHeader>

        {/* Send status — informational badge */}
        {entry.versions.length > 0 && (
          <div className="mt-3">
            {isMarkedForSend ? (
              <div className="flex items-center justify-center gap-2 rounded-lg bg-[#ef7c4a]/10 border border-[#ef7c4a]/20 px-4 py-2 text-sm font-medium text-[#ef7c4a]">
                <Star className="h-4 w-4 fill-current" />
                Top {entry.versions.length > 0 ? "campaign" : ""} — will be scheduled
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 rounded-lg bg-[#1e3a5f]/5 border border-[#1e3a5f]/10 px-4 py-2 text-sm text-[#1e3a5f]/40">
                Not in top {2} — won't be scheduled
              </div>
            )}
          </div>
        )}

        {/* Creative Brief */}
        {emailPlan && (emailPlan.hook || emailPlan.offer || emailPlan.graphic || emailPlan.context) && (
          <div className="mt-4 rounded-lg bg-[#f0f4f8] p-3 space-y-1.5">
            <h4 className="text-xs font-semibold text-[#1e3a5f]/60 uppercase tracking-wide">
              Creative Brief
            </h4>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              {emailPlan.hook && (
                <div>
                  <span className="text-[#1e3a5f]/50 text-xs">Hook </span>
                  <span className="text-[#1e3a5f]">{emailPlan.hook}</span>
                </div>
              )}
              {emailPlan.offer && (
                <div>
                  <span className="text-[#1e3a5f]/50 text-xs">Offer </span>
                  <span className="text-[#1e3a5f]">{emailPlan.offer}</span>
                </div>
              )}
              {emailPlan.graphic && (
                <div className="col-span-2">
                  <span className="text-[#1e3a5f]/50 text-xs">Graphic </span>
                  <span className="text-[#1e3a5f]">{emailPlan.graphic}</span>
                </div>
              )}
              {emailPlan.context && (
                <div className="col-span-2">
                  <span className="text-[#1e3a5f]/50 text-xs">Context </span>
                  <span className="text-[#1e3a5f]">{emailPlan.context}</span>
                </div>
              )}
            </div>
          </div>
        )}

        <Separator className="my-4" />

        {/* Version Comparison */}
        {entry.versions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No versions generated yet
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {[versionA, versionB].filter(Boolean).map((version) => (
              <VersionCard
                key={version!.id}
                version={version!}
                onSelect={() => handleSelectVersion(version!.id)}
              />
            ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function VersionCard({
  version,
  onSelect,
}: {
  version: VersionWithChat;
  onSelect: () => void;
}) {
  const hasScore = version.critiqueScore != null;
  const score = version.critiqueScore ?? 0;

  return (
    <div
      className={`rounded-lg border overflow-hidden ${
        version.isSelected
          ? "border-[#ef7c4a]/40 ring-2 ring-[#ef7c4a]/20"
          : "border-[#1e3a5f]/10"
      }`}
    >
      {/* Screenshot */}
      <div className="relative aspect-[4/5] bg-[#f0f4f8] overflow-hidden">
        {version.screenshotUrl ? (
          <img
            src={version.screenshotUrl}
            alt={version.subjectLine ?? `Version ${version.versionLabel}`}
            className="w-full h-full object-cover object-top"
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <span className="text-xs text-[#1e3a5f]/30">No preview</span>
          </div>
        )}

        {/* Score overlay */}
        {hasScore && (
          <div className="absolute top-2 left-2">
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-1 text-sm font-bold shadow-sm ${getScoreColor(score)}`}
            >
              {score} ({getLetterGrade(score)})
            </span>
          </div>
        )}

        {/* Winner badge */}
        {version.isSelected && (
          <div className="absolute top-2 right-2">
            <span className="inline-flex items-center rounded-full bg-[#ef7c4a] text-white px-2 py-0.5 text-xs font-semibold shadow-sm">
              <Trophy className="mr-1 h-3 w-3" />
              Winner
            </span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-[#1e3a5f]/60">
            Version {version.versionLabel}
          </span>
          {version.creativeAngle && (
            <span className="text-[10px] text-[#1e3a5f]/40 truncate ml-2">
              {version.creativeAngle}
            </span>
          )}
        </div>

        {/* Subject line */}
        {version.subjectLine && (
          <p className="text-sm font-medium text-[#1e3a5f] line-clamp-2">
            {version.subjectLine}
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          {version.isSelected ? (
            <div className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white">
              <Check className="h-3 w-3" />
              Selected
            </div>
          ) : hasScore ? (
            <button
              onClick={onSelect}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-[#1e3a5f]/15 px-3 py-1.5 text-xs font-medium text-[#1e3a5f]/60 transition-colors hover:border-[#ef7c4a]/40 hover:text-[#ef7c4a]"
            >
              Select this version
            </button>
          ) : null}
          {version.chatId && (
            <a
              href={`/app/email?chatId=${version.chatId}`}
              className="text-xs text-[#ef7c4a] hover:underline inline-flex items-center gap-1"
              onClick={(e) => e.stopPropagation()}
            >
              Open
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
