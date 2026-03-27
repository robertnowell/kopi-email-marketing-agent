"use server";

import { getActiveIdeas } from "@/db/main/ideas-service";
import {
  createAgentWeek,
  getAgentWeeks,
  type AgentWeekWithEntries,
} from "@/db/main/agent-service";

/**
 * Get the Monday of the week containing the given date.
 */
function getMonday(d: Date): Date {
  const date = new Date(d);
  const day = date.getUTCDay(); // 0=Sun, 1=Mon, ...
  const diff = day === 0 ? -6 : 1 - day; // adjust to Monday
  date.setUTCDate(date.getUTCDate() + diff);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

/**
 * Normalize a Date to just the YYYY-MM-DD string (date portion only).
 * Handles both UTC midnight and local-timezone midnight representations
 * that Drizzle's date column with mode:"date" can return.
 */
function toDateKey(d: Date): string {
  // Use UTC to avoid timezone shifts — PG date "2026-03-30" should always
  // compare as "2026-03-30" regardless of local timezone
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Find the next Monday that doesn't already have an agent week for this brand.
 * Starts from next Monday relative to today, skips any that already exist.
 */
async function findNextUnplannedWeek(brandId: string): Promise<Date> {
  const existingWeeks = await getAgentWeeks(brandId, 50);
  const existingDates = new Set(existingWeeks.map((w) => toDateKey(w.weekOf)));

  console.log(
    `[AgentWeek] Existing week dates: ${[...existingDates].join(", ") || "(none)"}`
  );

  // Start from next Monday
  const now = new Date();
  let monday = getMonday(now);
  // If today is already past this week's Monday, jump to next Monday
  if (now.getTime() >= monday.getTime()) {
    monday.setUTCDate(monday.getUTCDate() + 7);
  }

  // Skip any Mondays that already have weeks (up to 52 weeks out)
  for (let i = 0; i < 52; i++) {
    const dateStr = toDateKey(monday);
    console.log(`[AgentWeek] Checking ${dateStr} — ${existingDates.has(dateStr) ? "taken" : "available"}`);
    if (!existingDates.has(dateStr)) {
      return monday;
    }
    monday = new Date(monday);
    monday.setUTCDate(monday.getUTCDate() + 7);
  }

  throw new Error("No available weeks in the next year");
}

/**
 * Select the top campaign ideas for the next unplanned week and create an agent week.
 *
 * Automatically picks the next Monday that doesn't already have an agent week.
 * Filters to category='campaign' (no flow improvements), excludes expired,
 * sorts by priority DESC, takes top N (default 5).
 */
export async function selectIdeasForWeek(input: {
  brandId: string;
  weekOf?: Date;
  maxIdeas?: number;
  createdByUserId?: string;
}): Promise<{
  week: AgentWeekWithEntries;
  warnings: string[];
}> {
  const maxIdeas = input.maxIdeas ?? 5;
  const warnings: string[] = [];

  // Auto-pick next unplanned week if not specified
  const weekOf = input.weekOf ?? (await findNextUnplannedWeek(input.brandId));

  // Get active ideas, already sorted by priority DESC
  const allIdeas = await getActiveIdeas(input.brandId);

  // Filter to campaigns only (no flow improvement ideas)
  const campaignIdeas = allIdeas.filter((idea) => idea.category === "campaign");

  if (campaignIdeas.length === 0) {
    throw new Error(
      "No active campaign ideas available. Generate ideas first."
    );
  }

  if (campaignIdeas.length < 3) {
    warnings.push(
      `Only ${campaignIdeas.length} active campaign ideas available. Consider generating more ideas for better variety.`
    );
  }

  // Take top N by priority
  const selectedIdeas = campaignIdeas.slice(0, maxIdeas);

  // Extract preview metadata from each idea for the campaign cards
  const ideasWithMeta = selectedIdeas.map((idea) => {
    const sd = idea.sourceData as Record<string, unknown> | null;
    const articles = (sd?.articles as Array<{ articleImage?: string }>) ?? [];
    const articleImage = articles[0]?.articleImage ?? null;
    return {
      id: idea.id,
      previewMeta: {
        recommendationType: idea.recommendationType,
        category: idea.category,
        articleImage,
      },
    };
  });

  const week = await createAgentWeek({
    brandId: input.brandId,
    weekOf,
    ideas: ideasWithMeta,
    createdByUserId: input.createdByUserId,
  });

  return { week, warnings };
}
