import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "./client";
import {
  agentWeeks,
  chat,
  contentCalendarEntries,
  contentCalendarEntryVersions,
  type AgentWeek,
  type ContentCalendarEntry,
  type ContentCalendarEntryVersion,
} from "./schema";
import { createCalendarEntryFromIdea } from "./content-calendar-service";
import {
  getKlaviyoIntegration,
  updateKlaviyoSettings,
} from "./klaviyo-service";
import type { KlaviyoSettings } from "@/lib/integrations/klaviyo/klaviyo-types";

// ============================================================================
// Types
// ============================================================================

export type AgentWeekStatus = AgentWeek["status"];

export interface VersionWithChat extends ContentCalendarEntryVersion {
  /** Subject line (chat.title) */
  subjectLine: string | null;
  /** Screenshot URL from chat metadata */
  screenshotUrl: string | null;
}

export interface AgentWeekWithEntries extends AgentWeek {
  entries: (ContentCalendarEntry & {
    versions: VersionWithChat[];
  })[];
}

// ============================================================================
// Agent Weeks
// ============================================================================

export async function getAgentWeeks(
  brandId: string,
  limit = 10
): Promise<AgentWeekWithEntries[]> {
  const weeks = await db
    .select()
    .from(agentWeeks)
    .where(eq(agentWeeks.brandId, brandId))
    .orderBy(desc(agentWeeks.weekOf))
    .limit(limit);

  if (weeks.length === 0) return [];

  const weekIds = weeks.map((w) => w.id);
  const entries = await db
    .select()
    .from(contentCalendarEntries)
    .where(
      sql`${contentCalendarEntries.agentWeekId} IN (${sql.join(
        weekIds.map((id) => sql`${id}`),
        sql`, `
      )})`
    );

  const entryIds = entries.map((e) => e.id);
  const rawVersions =
    entryIds.length > 0
      ? await db
          .select()
          .from(contentCalendarEntryVersions)
          .where(
            sql`${contentCalendarEntryVersions.entryId} IN (${sql.join(
              entryIds.map((id) => sql`${id}`),
              sql`, `
            )})`
          )
      : [];

  // Enrich versions with chat data (subject line + screenshot)
  const chatIds = rawVersions
    .map((v) => v.chatId)
    .filter((id): id is string => id != null);
  const chatRows =
    chatIds.length > 0
      ? await db
          .select({ id: chat.id, title: chat.title, metadata: chat.metadata })
          .from(chat)
          .where(
            sql`${chat.id} IN (${sql.join(
              chatIds.map((id) => sql`${id}`),
              sql`, `
            )})`
          )
      : [];
  const chatMap = new Map(chatRows.map((c) => [c.id, c]));

  const versions: VersionWithChat[] = rawVersions.map((v) => {
    const c = v.chatId ? chatMap.get(v.chatId) : null;
    const meta = c?.metadata as Record<string, unknown> | null;
    return {
      ...v,
      subjectLine: c?.title ?? null,
      screenshotUrl: (meta?.previewScreenshotUrl as string) ?? null,
    };
  });

  const versionsByEntry = new Map<string, VersionWithChat[]>();
  for (const v of versions) {
    const arr = versionsByEntry.get(v.entryId) ?? [];
    arr.push(v);
    versionsByEntry.set(v.entryId, arr);
  }

  const entriesByWeek = new Map<
    string,
    (ContentCalendarEntry & { versions: VersionWithChat[] })[]
  >();
  for (const e of entries) {
    const weekId = e.agentWeekId;
    if (!weekId) continue;
    const arr = entriesByWeek.get(weekId) ?? [];
    arr.push({ ...e, versions: versionsByEntry.get(e.id) ?? [] });
    entriesByWeek.set(weekId, arr);
  }

  return weeks.map((w) => ({
    ...w,
    entries: entriesByWeek.get(w.id) ?? [],
  }));
}

export async function getAgentWeek(
  weekId: string
): Promise<AgentWeekWithEntries | null> {
  const [week] = await db
    .select()
    .from(agentWeeks)
    .where(eq(agentWeeks.id, weekId))
    .limit(1);

  if (!week) return null;

  const entries = await db
    .select()
    .from(contentCalendarEntries)
    .where(eq(contentCalendarEntries.agentWeekId, weekId));

  const entryIds = entries.map((e) => e.id);
  const rawVersions =
    entryIds.length > 0
      ? await db
          .select()
          .from(contentCalendarEntryVersions)
          .where(
            sql`${contentCalendarEntryVersions.entryId} IN (${sql.join(
              entryIds.map((id) => sql`${id}`),
              sql`, `
            )})`
          )
      : [];

  // Enrich with chat data
  const chatIds = rawVersions.map((v) => v.chatId).filter((id): id is string => id != null);
  const chatRows =
    chatIds.length > 0
      ? await db
          .select({ id: chat.id, title: chat.title, metadata: chat.metadata })
          .from(chat)
          .where(sql`${chat.id} IN (${sql.join(chatIds.map((id) => sql`${id}`), sql`, `)})`)
      : [];
  const chatMap = new Map(chatRows.map((c) => [c.id, c]));

  const versions: VersionWithChat[] = rawVersions.map((v) => {
    const c = v.chatId ? chatMap.get(v.chatId) : null;
    const meta = c?.metadata as Record<string, unknown> | null;
    return {
      ...v,
      subjectLine: c?.title ?? null,
      screenshotUrl: (meta?.previewScreenshotUrl as string) ?? null,
    };
  });

  const versionsByEntry = new Map<string, VersionWithChat[]>();
  for (const v of versions) {
    const arr = versionsByEntry.get(v.entryId) ?? [];
    arr.push(v);
    versionsByEntry.set(v.entryId, arr);
  }

  return {
    ...week,
    entries: entries.map((e) => ({
      ...e,
      versions: versionsByEntry.get(e.id) ?? [],
    })),
  };
}

export async function createAgentWeek(input: {
  brandId: string;
  weekOf: Date;
  ideas: Array<{
    id: string;
    previewMeta?: {
      recommendationType?: string | null;
      category?: string | null;
      articleImage?: string | null;
    };
  }>;
  createdByUserId?: string;
}): Promise<AgentWeekWithEntries> {
  const [week] = await db
    .insert(agentWeeks)
    .values({
      brandId: input.brandId,
      weekOf: input.weekOf,
      status: "ideas_selected",
    })
    .returning();

  const entries: (ContentCalendarEntry & {
    versions: VersionWithChat[];
  })[] = [];

  for (const idea of input.ideas) {
    const entry = await createCalendarEntryFromIdea({
      ideaId: idea.id,
      plannedDate: input.weekOf,
      createdByUserId: input.createdByUserId,
    });

    // Link entry to agent week, mark source, and store preview metadata
    const sourceMetadata: Record<string, unknown> = {
      ...(entry.sourceMetadata as Record<string, unknown> | null),
    };
    if (idea.previewMeta) {
      if (idea.previewMeta.recommendationType)
        sourceMetadata.recommendationType = idea.previewMeta.recommendationType;
      if (idea.previewMeta.category)
        sourceMetadata.category = idea.previewMeta.category;
      if (idea.previewMeta.articleImage)
        sourceMetadata.articleImage = idea.previewMeta.articleImage;
    }

    await db
      .update(contentCalendarEntries)
      .set({
        agentWeekId: week.id,
        source: "agent",
        sourceMetadata,
        updatedAt: new Date(),
      })
      .where(eq(contentCalendarEntries.id, entry.id));

    entries.push({
      ...entry,
      agentWeekId: week.id,
      source: "agent",
      sourceMetadata,
      isSelectedForSend: false,
      versions: [],
    });
  }

  return { ...week, entries };
}

// ============================================================================
// Week Status
// ============================================================================

export async function updateWeekStatus(
  weekId: string,
  status: AgentWeekStatus,
  errorMessage?: string | null
): Promise<void> {
  await db
    .update(agentWeeks)
    .set({
      status,
      errorMessage: errorMessage ?? null,
      updatedAt: new Date(),
    })
    .where(eq(agentWeeks.id, weekId));
}

// ============================================================================
// Entry Versions
// ============================================================================

export async function createEntryVersion(input: {
  entryId: string;
  chatId: string;
  versionLabel: string;
  creativeAngle?: string;
}): Promise<ContentCalendarEntryVersion> {
  const [version] = await db
    .insert(contentCalendarEntryVersions)
    .values({
      entryId: input.entryId,
      chatId: input.chatId,
      versionLabel: input.versionLabel,
      creativeAngle: input.creativeAngle,
    })
    .returning();

  return version;
}

export async function updateVersionScore(
  versionId: string,
  critiqueScore: number
): Promise<void> {
  await db
    .update(contentCalendarEntryVersions)
    .set({ critiqueScore, updatedAt: new Date() })
    .where(eq(contentCalendarEntryVersions.id, versionId));
}

export async function selectVersionWinner(
  entryId: string,
  versionId: string
): Promise<void> {
  await db.transaction(async (tx) => {
    // Clear previous selection
    await tx
      .update(contentCalendarEntryVersions)
      .set({ isSelected: false, updatedAt: new Date() })
      .where(eq(contentCalendarEntryVersions.entryId, entryId));

    // Set new winner
    const [winner] = await tx
      .update(contentCalendarEntryVersions)
      .set({ isSelected: true, updatedAt: new Date() })
      .where(eq(contentCalendarEntryVersions.id, versionId))
      .returning();

    if (!winner) return;

    // Update entry's generatedChatId to the winning version's chat
    await tx
      .update(contentCalendarEntries)
      .set({
        generatedChatId: winner.chatId,
        status: "generated",
        updatedAt: new Date(),
      })
      .where(eq(contentCalendarEntries.id, entryId));
  });
}

// ============================================================================
// Auto-Selection (top N campaigns by best version score)
// ============================================================================

export async function autoSelectTopCampaigns(
  weekId: string,
  count = 2
): Promise<void> {
  const entries = await db
    .select()
    .from(contentCalendarEntries)
    .where(eq(contentCalendarEntries.agentWeekId, weekId));

  if (entries.length === 0) return;

  // Get all versions for these entries
  const entryIds = entries.map((e) => e.id);
  const versions = await db
    .select()
    .from(contentCalendarEntryVersions)
    .where(
      sql`${contentCalendarEntryVersions.entryId} IN (${sql.join(
        entryIds.map((id) => sql`${id}`),
        sql`, `
      )})`
    );

  // For each entry, find the best version score and auto-select winner
  const entryScores: { entryId: string; bestScore: number }[] = [];

  const versionsByEntry = new Map<string, ContentCalendarEntryVersion[]>();
  for (const v of versions) {
    const arr = versionsByEntry.get(v.entryId) ?? [];
    arr.push(v);
    versionsByEntry.set(v.entryId, arr);
  }

  for (const entry of entries) {
    const entryVersions = versionsByEntry.get(entry.id) ?? [];
    if (entryVersions.length === 0) continue;

    // Find best version
    const scored = entryVersions.filter((v) => v.critiqueScore != null);
    if (scored.length === 0) continue;

    const best = scored.reduce((a, b) =>
      (a.critiqueScore ?? 0) > (b.critiqueScore ?? 0) ? a : b
    );

    // Auto-select the winning version if not already selected
    const alreadySelected = entryVersions.some((v) => v.isSelected);
    if (!alreadySelected) {
      await selectVersionWinner(entry.id, best.id);
    }

    entryScores.push({
      entryId: entry.id,
      bestScore: best.critiqueScore ?? 0,
    });
  }

  // Sort by score and pick top N
  entryScores.sort((a, b) => b.bestScore - a.bestScore);
  const topEntryIds = new Set(
    entryScores.slice(0, count).map((e) => e.entryId)
  );

  // Clear previous selections for this week
  for (const entry of entries) {
    await db
      .update(contentCalendarEntries)
      .set({
        isSelectedForSend: topEntryIds.has(entry.id),
        updatedAt: new Date(),
      })
      .where(eq(contentCalendarEntries.id, entry.id));
  }

  // Store selection audit trail on the week
  await db
    .update(agentWeeks)
    .set({
      selectionMetadata: {
        selectedAt: new Date().toISOString(),
        rankings: entryScores.map((e, i) => ({
          entryId: e.entryId,
          score: e.bestScore,
          rank: i + 1,
          selected: topEntryIds.has(e.entryId),
        })),
      },
      updatedAt: new Date(),
    })
    .where(eq(agentWeeks.id, weekId));
}

// ============================================================================
// Agent Settings (stored in Klaviyo integration settings)
// ============================================================================

export type AgentSettings = NonNullable<KlaviyoSettings["agentSettings"]>;

export async function getAgentSettings(
  brandId: string
): Promise<AgentSettings | null> {
  const integration = await getKlaviyoIntegration(brandId);
  if (!integration?.settings) return null;

  const settings = integration.settings as unknown as KlaviyoSettings;
  return settings.agentSettings ?? null;
}

export async function updateAgentSettings(
  brandId: string,
  agentSettings: AgentSettings
): Promise<void> {
  await updateKlaviyoSettings(brandId, { agentSettings });
}
