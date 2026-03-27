"use client";

import Link from "next/link";
import { Calendar, Trophy, Users, Mail } from "lucide-react";

export interface CampaignPerformance {
  recipients: number;
  openRate: number;
  clickRate: number;
  unsubscribeRate: number;
  revenue: number;
  sentAt: string;
}

export interface SentCampaign {
  id: string;
  title: string;
  screenshotUrl: string | null;
  critiqueScore: number | null;
  performance: CampaignPerformance;
}

interface AgentSentWeekCardProps {
  weekOf: Date | string;
  campaigns: SentCampaign[];
}

function formatWeekOf(dateValue: Date | string): string {
  const date =
    typeof dateValue === "string" ? new Date(dateValue) : dateValue;
  return `Week of ${date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatPct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function formatRevenue(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

export function AgentSentWeekCard({
  weekOf,
  campaigns,
}: AgentSentWeekCardProps) {
  const winnerId =
    campaigns.length >= 2
      ? campaigns.reduce((best, c) =>
          c.performance.clickRate > best.performance.clickRate ||
          (c.performance.clickRate === best.performance.clickRate &&
            c.performance.revenue > best.performance.revenue)
            ? c
            : best
        ).id
      : null;

  return (
    <div className="rounded-xl border border-[#1e3a5f]/10 bg-white p-5 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1e3a5f]/5">
            <Calendar className="h-4 w-4 text-[#1e3a5f]" />
          </div>
          <h3 className="font-semibold text-[#1e3a5f]">
            {formatWeekOf(weekOf)}
          </h3>
          <span className="inline-flex items-center rounded-full border border-[#1e3a5f] bg-[#1e3a5f] px-2.5 py-0.5 text-xs font-medium text-white">
            Sent
          </span>
          <span className="text-sm text-[#1e3a5f]/40">
            {campaigns.length} campaign{campaigns.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Compact campaign results — horizontal cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {campaigns.map((campaign) => {
          const isWinner = campaign.id === winnerId;
          const perf = campaign.performance;

          return (
            <Link
              key={campaign.id}
              href={`/p/${campaign.id}`}
              target="_blank"
              className={`relative flex rounded-lg border overflow-hidden cursor-pointer transition-shadow hover:shadow-md ${
                isWinner
                  ? "border-[#ef7c4a]/30 ring-1 ring-[#ef7c4a]/20"
                  : "border-[#1e3a5f]/10"
              }`}
            >
              {/* Winner badge — absolute positioned over thumbnail */}
              {isWinner && (
                <span className="absolute top-1.5 left-1.5 z-10 inline-flex items-center gap-1 rounded-full bg-[#ef7c4a] px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm">
                  <Trophy className="h-3 w-3" />
                  Best
                </span>
              )}

              {/* Thumbnail */}
              <div className="w-24 shrink-0 bg-[#f0f4f8] overflow-hidden">
                {campaign.screenshotUrl ? (
                  <img
                    src={campaign.screenshotUrl}
                    alt={campaign.title}
                    className="w-full h-full object-cover object-top"
                  />
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <Mail className="h-6 w-6 text-[#1e3a5f]/15" />
                  </div>
                )}
              </div>

              {/* Content */}
              <div className="flex-1 p-3 min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <h4 className="text-sm font-semibold text-[#1e3a5f] line-clamp-1 leading-snug flex-1 min-w-0">
                    {campaign.title}
                  </h4>
                  {campaign.critiqueScore != null && (
                    <span className={`shrink-0 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-bold ${
                      campaign.critiqueScore >= 80
                        ? "text-emerald-700 bg-emerald-50 border-emerald-200"
                        : campaign.critiqueScore >= 60
                          ? "text-amber-700 bg-amber-50 border-amber-200"
                          : "text-red-700 bg-red-50 border-red-200"
                    }`}>
                      {campaign.critiqueScore}
                    </span>
                  )}
                </div>

                {/* Metrics row */}
                <div className="flex items-baseline gap-4 mb-1.5">
                  <div>
                    <span className="text-base font-bold text-[#1e3a5f]">
                      {formatPct(perf.openRate)}
                    </span>
                    <span className="text-[10px] text-[#1e3a5f]/40 ml-1">
                      opens
                    </span>
                  </div>
                  <div>
                    <span className="text-base font-bold text-[#1e3a5f]">
                      {formatPct(perf.clickRate)}
                    </span>
                    <span className="text-[10px] text-[#1e3a5f]/40 ml-1">
                      clicks
                    </span>
                  </div>
                  {perf.revenue > 0 && (
                    <div>
                      <span className="text-base font-bold text-emerald-700">
                        {formatRevenue(perf.revenue)}
                      </span>
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="flex items-center gap-3 text-[10px] text-[#1e3a5f]/40">
                  <span className="flex items-center gap-0.5">
                    <Users className="h-2.5 w-2.5" />
                    {formatNumber(perf.recipients)}
                  </span>
                  <span>Sent {formatDate(perf.sentAt)}</span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
