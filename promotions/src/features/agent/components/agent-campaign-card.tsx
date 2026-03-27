"use client";

import { useState } from "react";
import { Star, Loader2, Newspaper, TrendingUp, Megaphone, Package, Sparkles } from "lucide-react";
import type { ContentCalendarEntry } from "@/db/main/schema";
import type { VersionWithChat } from "@/db/main/agent-service";

type EntryWithVersions = ContentCalendarEntry & {
  versions: VersionWithChat[];
};

interface AgentCampaignCardProps {
  entry: EntryWithVersions;
  onClick?: () => void;
  brandColor?: string;
  deEmphasized?: boolean;
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

const CATEGORY_ICONS: Record<string, typeof Megaphone> = {
  newsjacking: Newspaper,
  promotional: Megaphone,
  product_launch: Package,
  seasonal: Sparkles,
  performance: TrendingUp,
};

export function AgentCampaignCard({ entry, onClick, brandColor, deEmphasized }: AgentCampaignCardProps) {
  const [imgError, setImgError] = useState(false);
  const versions = entry.versions;
  const isSelected = entry.isSelectedForSend === true;
  // Show selected winner, or fall back to highest-scoring version (not just first)
  const selectedWinner = versions.find((v) => v.isSelected);
  const highestScored = [...versions]
    .filter((v) => v.critiqueScore != null)
    .sort((a, b) => (b.critiqueScore ?? 0) - (a.critiqueScore ?? 0))[0];
  const winner = selectedWinner ?? highestScored ?? versions[0];
  const scored = versions.filter((v) => v.critiqueScore != null);
  const bestScore = winner?.critiqueScore ?? (scored.length > 0
    ? Math.max(...scored.map((v) => v.critiqueScore!))
    : null);

  const screenshotUrl = winner?.screenshotUrl;
  const subjectLine = winner?.subjectLine ?? entry.title;

  // Preview image for ungenerated entries — article OG image or category icon
  const sourceMeta = entry.sourceMetadata as Record<string, unknown> | null;
  const articleImage = (sourceMeta?.articleImage as string) ?? null;
  const category = (sourceMeta?.category as string) ?? (sourceMeta?.recommendationType as string) ?? null;
  const CategoryIcon = category ? (CATEGORY_ICONS[category] ?? Megaphone) : Megaphone;

  const isGenerating = entry.status === "generating" || entry.status === "queued";
  const isFailed = entry.status === "failed";
  const isGenerated = entry.status === "generated" && versions.length > 0;

  const ringColor = brandColor ?? "#ef7c4a";
  const starColor = brandColor ?? "#ef7c4a";

  return (
    <div
      className={`group relative rounded-lg border bg-white overflow-hidden transition-all cursor-pointer hover:shadow-md ${
        isSelected
          ? "ring-2 border-transparent"
          : deEmphasized
            ? "border-[#1e3a5f]/8 opacity-60 hover:opacity-90"
            : "border-[#1e3a5f]/10 hover:border-[#1e3a5f]/25"
      }`}
      style={isSelected ? { borderColor: `${ringColor}40`, boxShadow: `0 0 0 2px ${ringColor}30` } : undefined}
      onClick={onClick}
    >
      {/* Screenshot preview */}
      <div className="relative aspect-[4/3] bg-[#f0f4f8] overflow-hidden">
        {screenshotUrl ? (
          <img
            src={screenshotUrl}
            alt={subjectLine}
            className="w-full h-full object-cover object-top"
          />
        ) : isGenerating ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-6 w-6 animate-spin" style={{ color: ringColor }} />
          </div>
        ) : articleImage && !imgError ? (
          <img
            src={articleImage}
            alt={subjectLine}
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <CategoryIcon className="h-8 w-8 text-[#1e3a5f]/15" />
          </div>
        )}

        {/* Score badge overlay */}
        {bestScore != null && (
          <div className="absolute top-2 left-2">
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-bold shadow-sm ${getScoreColor(bestScore)}`}
            >
              {bestScore} ({getLetterGrade(bestScore)})
            </span>
          </div>
        )}

        {/* Selected for send star */}
        {isSelected && (
          <div className="absolute top-2 right-2">
            <Star className="h-5 w-5 drop-shadow-sm" style={{ color: starColor, fill: starColor }} />
          </div>
        )}

        {/* Version count */}
        {scored.length === 2 && (
          <div className="absolute bottom-2 right-2">
            <span className="text-[10px] bg-white/80 backdrop-blur-sm rounded-full px-1.5 py-0.5 text-[#1e3a5f]/60 font-medium">
              2 versions
            </span>
          </div>
        )}
      </div>

      {/* Content area */}
      <div className="p-3">
        <h4 className="text-sm font-medium text-[#1e3a5f] line-clamp-2 leading-snug">
          {subjectLine}
        </h4>

        {/* Status — only show for non-generated states */}
        {isGenerating && (
          <div className="mt-2">
            <span className="inline-flex items-center text-xs font-medium" style={{ color: ringColor }}>
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              Generating
            </span>
          </div>
        )}
        {isFailed && (
          <div className="mt-2">
            <span className="text-xs text-red-600 font-medium">Failed</span>
          </div>
        )}
        {!isGenerating && !isFailed && !isGenerated && (
          <div className="mt-2">
            <span className="text-xs text-[#1e3a5f]/40">Pending</span>
          </div>
        )}
      </div>
    </div>
  );
}
