"use server";

import { db } from "@/db/main/client";
import {
  chat,
  message,
  contentCalendarEntries,
  contentCalendarEntryVersions,
  contentCalendarGenerationTasks,
} from "@/db/main/schema";
import {
  getAgentWeek,
  updateWeekStatus,
  updateVersionScore,
  selectVersionWinner,
  autoSelectTopCampaigns,
} from "@/db/main/agent-service";
import { eq, and, inArray, desc } from "drizzle-orm";
import type { MessageMetadata } from "@/types/chat-types";

export interface AgentGenerationStatus {
  weekId: string;
  weekStatus: string;
  entries: {
    entryId: string;
    entryStatus: string;
    versions: {
      versionLabel: string;
      chatId: string | null;
      critiqueScore: number | null;
      generationStatus: string | null;
      isSelected: boolean;
    }[];
  }[];
  allDone: boolean;
}

/**
 * Poll generation status for an agent week.
 *
 * Checks each version's chat generation status, extracts critique scores
 * when ready, auto-selects winners, and advances week status.
 */
export async function pollAgentGeneration(
  weekId: string
): Promise<AgentGenerationStatus> {
  const week = await getAgentWeek(weekId);
  if (!week) {
    throw new Error("Agent week not found");
  }

  const entriesStatus: AgentGenerationStatus["entries"] = [];
  let allEntriesDone = true;
  let anyScoresExtracted = false;

  for (const entry of week.entries) {
    const versions = entry.versions;

    const versionStatuses: AgentGenerationStatus["entries"][number]["versions"] = [];
    // Track freshly extracted scores for winner selection (stale array won't have them)
    const freshScores = new Map<string, number>();
    let entryDone = true;

    for (const version of versions) {
      if (!version.chatId) {
        versionStatuses.push({
          versionLabel: version.versionLabel,
          chatId: null,
          critiqueScore: version.critiqueScore,
          generationStatus: "pending",
          isSelected: version.isSelected,
        });
        entryDone = false;
        continue;
      }

      // Read chat generation status
      const [chatRow] = await db
        .select({ metadata: chat.metadata })
        .from(chat)
        .where(eq(chat.id, version.chatId))
        .limit(1);

      const chatMetadata = chatRow?.metadata as Record<string, unknown> | null;
      const generationStatus =
        (chatMetadata?.generationStatus as string) ?? "unknown";

      let score = version.critiqueScore;

      // If generation is done and we don't have a score yet, extract it
      if (generationStatus === "success" && score == null) {
        score = await extractCritiqueScore(version.chatId);
        if (score != null) {
          await updateVersionScore(version.id, score);
          anyScoresExtracted = true;
        }
      }

      if (score != null) {
        freshScores.set(version.id, score);
      }

      if (generationStatus !== "success" && generationStatus !== "error") {
        entryDone = false;
      }

      versionStatuses.push({
        versionLabel: version.versionLabel,
        chatId: version.chatId,
        critiqueScore: score,
        generationStatus,
        isSelected: version.isSelected,
      });
    }

    // If all versions for this entry are done, auto-select the highest-scoring version.
    // Re-evaluates even if a winner was previously set (e.g. version A selected before B scored).
    if (entryDone && versions.length > 0 && freshScores.size > 0) {
      let bestId = "";
      let bestScore = -1;
      for (const [versionId, score] of freshScores) {
        if (score > bestScore) {
          bestScore = score;
          bestId = versionId;
        }
      }
      // Only update if the best version isn't already the selected winner
      const currentWinner = versions.find((v) => v.isSelected);
      if (bestId && currentWinner?.id !== bestId) {
        await selectVersionWinner(entry.id, bestId);
      }
    }

    if (!entryDone) {
      allEntriesDone = false;
    }

    entriesStatus.push({
      entryId: entry.id,
      entryStatus: entry.status,
      versions: versionStatuses,
    });
  }

  // If all entries are done, advance week status and select top campaigns
  if (allEntriesDone && week.entries.length > 0) {
    if (week.status === "generating") {
      await updateWeekStatus(weekId, "generated");
    }
    // Run auto-select if any scores were freshly extracted
    if (anyScoresExtracted) {
      await autoSelectTopCampaigns(weekId, week.sendCount);
    }
  }

  return {
    weekId,
    weekStatus: allEntriesDone && week.status === "generating"
      ? "generated"
      : week.status,
    entries: entriesStatus,
    allDone: allEntriesDone,
  };
}

/**
 * Extract the critique score from a chat's message metadata.
 *
 * Tries selectedMessageId first, then falls back to the most recent
 * message for the chat (covers cases where selectedMessageId isn't set yet).
 */
async function extractCritiqueScore(
  chatId: string
): Promise<number | null> {
  // Get the chat to find its selected message
  const [chatRow] = await db
    .select({ metadata: chat.metadata })
    .from(chat)
    .where(eq(chat.id, chatId))
    .limit(1);

  const chatMeta = chatRow?.metadata as Record<string, unknown> | null;
  const selectedMessageId = chatMeta?.selectedMessageId as string | undefined;

  // Try selected message first, fall back to most recent message for this chat
  let msgMeta: MessageMetadata | null = null;

  if (selectedMessageId) {
    const [msg] = await db
      .select({ metadata: message.metadata })
      .from(message)
      .where(eq(message.id, selectedMessageId))
      .limit(1);
    msgMeta = (msg?.metadata as MessageMetadata) ?? null;
  }

  if (!msgMeta) {
    // Fallback: get most recent message for this chat
    const [msg] = await db
      .select({ metadata: message.metadata })
      .from(message)
      .where(eq(message.chatId, chatId))
      .orderBy(desc(message.createdAt))
      .limit(1);
    msgMeta = (msg?.metadata as MessageMetadata) ?? null;
  }

  if (!msgMeta) return null;

  // Batch generation stores scores in workflowEmailGeneration (primary path)
  const workflowScore =
    msgMeta?.workflowEmailGeneration?.latestCritiqueScore;
  if (workflowScore != null) return workflowScore;

  // Fallback: manual/auto preview critique
  const critiqueScore = msgMeta?.previewDesignCritique?.overallScore;
  if (critiqueScore != null) return critiqueScore;

  return null;
}
