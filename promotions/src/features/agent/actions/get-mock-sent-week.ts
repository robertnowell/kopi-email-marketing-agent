"use server";

import { db } from "@/db/main/client";
import { chat, message as messageTable } from "@/db/main/schema";
import { eq, sql, and, desc } from "drizzle-orm";
import type { SentCampaign, CampaignPerformance } from "../components/agent-sent-week-card";

/**
 * Fetch the top 2 exported (starred) emails for a brand to use as mock
 * "previous week" sent campaign data. Returns real titles and screenshots
 * with fabricated performance numbers.
 */
export async function getMockSentCampaigns(
  brandId: string
): Promise<SentCampaign[]> {
  // Find starred emails with screenshots, ordered by most recent
  const starred = await db
    .select({
      chatId: chat.id,
      title: chat.title,
      metadata: chat.metadata,
      createdAt: chat.createdAt,
    })
    .from(chat)
    .where(
      and(
        eq(chat.brandId, brandId),
        sql<boolean>`(CASE WHEN jsonb_typeof(${chat.metadata}::jsonb -> 'favoritedBy') = 'array' THEN jsonb_array_length(${chat.metadata}::jsonb -> 'favoritedBy') ELSE 0 END) > 0`,
        sql<boolean>`${chat.metadata}::jsonb ->> 'previewScreenshotUrl' IS NOT NULL`
      )
    )
    .orderBy(desc(chat.createdAt))
    .limit(2);

  if (starred.length === 0) return [];

  // For each starred email, get its critique score from the selected message
  const campaigns: SentCampaign[] = [];

  for (const c of starred) {
    const meta = c.metadata as Record<string, unknown> | null;
    const screenshotUrl = (meta?.previewScreenshotUrl as string) ?? null;
    const selectedMessageId = meta?.selectedMessageId as string | undefined;

    let critiqueScore: number | null = null;
    if (selectedMessageId) {
      const [msg] = await db
        .select({ metadata: messageTable.metadata })
        .from(messageTable)
        .where(eq(messageTable.id, selectedMessageId))
        .limit(1);

      if (msg?.metadata) {
        const msgMeta = msg.metadata as Record<string, unknown>;
        const critique = msgMeta.previewDesignCritique as
          | { overallScore?: number }
          | undefined;
        critiqueScore = critique?.overallScore ?? null;
      }
    }

    campaigns.push({
      id: c.chatId,
      title: c.title,
      screenshotUrl,
      critiqueScore,
      performance: generateMockPerformance(campaigns.length),
    });
  }

  return campaigns;
}

/** Generate plausible-looking mock performance numbers */
function generateMockPerformance(index: number): CampaignPerformance {
  // First campaign performs better (it's the "winner")
  const isFirst = index === 0;
  const now = new Date();
  const lastMonday = new Date(now);
  lastMonday.setDate(now.getDate() - ((now.getDay() + 6) % 7) - 7);

  const sendDate = new Date(lastMonday);
  sendDate.setDate(lastMonday.getDate() + (isFirst ? 1 : 3)); // Tue and Thu
  sendDate.setHours(10, 0, 0, 0);

  return {
    recipients: isFirst ? 12450 : 12450,
    openRate: isFirst ? 0.342 : 0.298,
    clickRate: isFirst ? 0.058 : 0.041,
    unsubscribeRate: isFirst ? 0.002 : 0.003,
    revenue: isFirst ? 2840 : 1920,
    sentAt: sendDate.toISOString(),
  };
}
