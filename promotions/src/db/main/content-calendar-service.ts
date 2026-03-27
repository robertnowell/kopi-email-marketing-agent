import { and, asc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "./client";
import {
  chat,
  contentCalendarMonitoringState,
  contentCalendarEntries,
  contentCalendarGenerationTasks,
  type ContentCalendarMonitoringState,
  type ContentCalendarEntry,
  type ContentCalendarGenerationTask,
  type NewContentCalendarMonitoringState,
  type NewContentCalendarEntry,
} from "./schema";
import { getIdeaById } from "./ideas-service";

export type ContentCalendarEntryType = "campaign" | "flow_improvement";
export type ContentCalendarEntryStatus =
  | "planned"
  | "queued"
  | "generating"
  | "generated"
  | "failed";
export type ContentCalendarTaskStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";
export type ContentCalendarMonitoringSeverity =
  | "healthy"
  | "warning"
  | "critical";

export class ContentCalendarValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentCalendarValidationError";
  }
}

export interface CreateContentCalendarEntryInput {
  brandId: string;
  entryType: ContentCalendarEntryType;
  title: string;
  ideaText: string;
  suggestedPrompt: string;
  plannedDate: Date;
  emailPlan?: Record<string, unknown> | null;
  flowId?: string | null;
  flowName?: string | null;
  targetMessageId?: string | null;
  sourceIdeaId?: string | null;
  createdByUserId?: string | null;
  source?: string;
  sourceMetadata?: Record<string, unknown> | null;
  autoGenerate?: boolean;
}

export interface UpdateContentCalendarEntryInput {
  title?: string;
  ideaText?: string;
  suggestedPrompt?: string;
  plannedDate?: Date;
  emailPlan?: Record<string, unknown> | null;
  flowId?: string | null;
  flowName?: string | null;
  targetMessageId?: string | null;
  entryType?: ContentCalendarEntryType;
  autoGenerate?: boolean;
  status?: ContentCalendarEntryStatus;
}

export interface QueueGenerationInput {
  entryId: string;
  triggerType: string;
  requestedByUserId?: string | null;
}

export interface QueuedContentCalendarBacklogStats {
  count: number;
  oldestQueuedAt: Date | null;
}

export interface ContentCalendarRecentTaskStats {
  runningCount: number;
  startedLast24h: number;
  completedLast24h: number;
  failedLast24h: number;
}

export interface UpdateContentCalendarMonitoringStateInput {
  alertKey: string;
  severity: ContentCalendarMonitoringSeverity;
  isActive: boolean;
  fingerprint?: string | null;
  metadata?: Record<string, unknown> | null;
  notificationCooldownMs: number;
  now?: Date;
}

export interface UpdateContentCalendarMonitoringStateResult {
  state: ContentCalendarMonitoringState;
  shouldNotifyCritical: boolean;
  shouldSendResolution: boolean;
}

function normalizeOptionalText(
  value: string | null | undefined
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeAndValidateFlowContext(input: {
  entryType: ContentCalendarEntryType;
  flowId?: string | null;
  flowName?: string | null;
  targetMessageId?: string | null;
}): {
  flowId: string | null;
  flowName: string | null;
  targetMessageId: string | null;
} {
  const flowId = normalizeOptionalText(input.flowId);
  const flowName = normalizeOptionalText(input.flowName);
  const targetMessageId = normalizeOptionalText(input.targetMessageId);

  if (input.entryType === "campaign") {
    if (flowId || flowName || targetMessageId) {
      throw new ContentCalendarValidationError(
        "Campaign entries cannot include flow fields"
      );
    }
    return { flowId: null, flowName: null, targetMessageId: null };
  }

  if (!flowId && !flowName && !targetMessageId) {
    throw new ContentCalendarValidationError(
      "Flow improvements require flow context (flowId, flowName, or targetMessageId)"
    );
  }

  return {
    flowId,
    flowName,
    targetMessageId,
  };
}

function getMonthBounds(
  year: number,
  month: number
): { start: Date; end: Date } {
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  return { start, end };
}

type ChatGenerationStatus = "pending" | "generating" | "success" | "error";

function parseChatGenerationStatus(
  metadata: unknown
): ChatGenerationStatus | null {
  if (!metadata || typeof metadata !== "object") return null;
  const record = metadata as {
    generationStatus?: unknown;
    generationStatusInfo?: { status?: unknown } | null;
  };
  const status =
    typeof record.generationStatus === "string"
      ? record.generationStatus
      : typeof record.generationStatusInfo?.status === "string"
        ? record.generationStatusInfo.status
        : null;
  if (
    status === "pending" ||
    status === "generating" ||
    status === "success" ||
    status === "error"
  ) {
    return status;
  }
  return null;
}

async function getDerivedEntryStatusFromOpenTasks(
  entryIds: string[]
): Promise<Map<string, ContentCalendarEntryStatus>> {
  if (entryIds.length === 0) return new Map();

  const openTasks = await db
    .select({
      entryId: contentCalendarGenerationTasks.entryId,
      status: contentCalendarGenerationTasks.status,
    })
    .from(contentCalendarGenerationTasks)
    .where(
      and(
        inArray(contentCalendarGenerationTasks.entryId, entryIds),
        inArray(contentCalendarGenerationTasks.status, ["queued", "running"])
      )
    );

  const statusByEntryId = new Map<string, ContentCalendarEntryStatus>();
  for (const task of openTasks) {
    if (task.status === "running") {
      statusByEntryId.set(task.entryId, "generating");
      continue;
    }
    if (!statusByEntryId.has(task.entryId)) {
      statusByEntryId.set(task.entryId, "queued");
    }
  }

  return statusByEntryId;
}

async function getDerivedEntryStatusFromGeneratedChats(
  entries: Array<Pick<ContentCalendarEntry, "id" | "generatedChatId">>
): Promise<Map<string, ContentCalendarEntryStatus>> {
  const entryIdsByChatId = new Map<string, string[]>();

  for (const entry of entries) {
    const chatId = entry.generatedChatId;
    if (!chatId) continue;
    const existing = entryIdsByChatId.get(chatId);
    if (existing) {
      existing.push(entry.id);
      continue;
    }
    entryIdsByChatId.set(chatId, [entry.id]);
  }

  const chatIds = Array.from(entryIdsByChatId.keys());
  if (chatIds.length === 0) return new Map();

  const rows = await db
    .select({ id: chat.id, metadata: chat.metadata })
    .from(chat)
    .where(inArray(chat.id, chatIds));

  const statusByEntryId = new Map<string, ContentCalendarEntryStatus>();
  for (const row of rows) {
    const chatStatus = parseChatGenerationStatus(row.metadata);
    if (!chatStatus) continue;

    let entryStatus: ContentCalendarEntryStatus;
    if (chatStatus === "success") {
      entryStatus = "generated";
    } else if (chatStatus === "error") {
      entryStatus = "failed";
    } else {
      entryStatus = "generating";
    }

    const entryIds = entryIdsByChatId.get(row.id) ?? [];
    for (const entryId of entryIds) {
      statusByEntryId.set(entryId, entryStatus);
    }
  }

  return statusByEntryId;
}

async function getDerivedEntryStatus(
  entries: Array<Pick<ContentCalendarEntry, "id" | "generatedChatId">>
): Promise<Map<string, ContentCalendarEntryStatus>> {
  if (entries.length === 0) return new Map();

  const statusByEntryId = await getDerivedEntryStatusFromOpenTasks(
    entries.map((entry) => entry.id)
  );

  const entriesWithoutOpenTasks = entries.filter(
    (entry) => !statusByEntryId.has(entry.id)
  );
  if (entriesWithoutOpenTasks.length === 0) return statusByEntryId;

  const chatDerivedStatus = await getDerivedEntryStatusFromGeneratedChats(
    entriesWithoutOpenTasks
  );
  for (const [entryId, status] of chatDerivedStatus) {
    statusByEntryId.set(entryId, status);
  }

  return statusByEntryId;
}

export async function getContentCalendarEntriesForMonth(
  brandId: string,
  year: number,
  month: number
): Promise<ContentCalendarEntry[]> {
  const { start, end } = getMonthBounds(year, month);
  const entries = await db
    .select()
    .from(contentCalendarEntries)
    .where(
      and(
        eq(contentCalendarEntries.brandId, brandId),
        gte(contentCalendarEntries.plannedDate, start),
        lt(contentCalendarEntries.plannedDate, end)
      )
    )
    .orderBy(
      asc(contentCalendarEntries.plannedDate),
      asc(contentCalendarEntries.createdAt)
    );

  const statusByEntryId = await getDerivedEntryStatus(entries);

  if (statusByEntryId.size === 0) return entries;

  return entries.map((entry) => {
    const derivedStatus = statusByEntryId.get(entry.id);
    if (!derivedStatus || derivedStatus === entry.status) return entry;
    return {
      ...entry,
      status: derivedStatus,
    };
  });
}

export async function getContentCalendarEntriesForDateRange(
  brandId: string,
  start: Date,
  end: Date
): Promise<ContentCalendarEntry[]> {
  const entries = await db
    .select()
    .from(contentCalendarEntries)
    .where(
      and(
        eq(contentCalendarEntries.brandId, brandId),
        gte(contentCalendarEntries.plannedDate, start),
        lt(contentCalendarEntries.plannedDate, end)
      )
    )
    .orderBy(
      asc(contentCalendarEntries.plannedDate),
      asc(contentCalendarEntries.createdAt)
    );

  const statusByEntryId = await getDerivedEntryStatus(entries);

  if (statusByEntryId.size === 0) return entries;

  return entries.map((entry) => {
    const derivedStatus = statusByEntryId.get(entry.id);
    if (!derivedStatus || derivedStatus === entry.status) return entry;
    return {
      ...entry,
      status: derivedStatus,
    };
  });
}

export async function getContentCalendarEntriesBySourceIdeaIds(
  brandId: string,
  sourceIdeaIds: string[],
  start: Date,
  end: Date
): Promise<ContentCalendarEntry[]> {
  if (sourceIdeaIds.length === 0) return [];

  const entries = await db
    .select()
    .from(contentCalendarEntries)
    .where(
      and(
        eq(contentCalendarEntries.brandId, brandId),
        inArray(contentCalendarEntries.sourceIdeaId, sourceIdeaIds),
        gte(contentCalendarEntries.plannedDate, start),
        lt(contentCalendarEntries.plannedDate, end)
      )
    )
    .orderBy(
      asc(contentCalendarEntries.plannedDate),
      asc(contentCalendarEntries.createdAt)
    );

  const statusByEntryId = await getDerivedEntryStatus(entries);

  if (statusByEntryId.size === 0) return entries;

  return entries.map((entry) => {
    const derivedStatus = statusByEntryId.get(entry.id);
    if (!derivedStatus || derivedStatus === entry.status) return entry;
    return {
      ...entry,
      status: derivedStatus,
    };
  });
}

export async function getSourceIdeaIdsInContentCalendar(
  brandId: string,
  ideaIds: string[]
): Promise<Set<string>> {
  if (ideaIds.length === 0) return new Set();

  const rows = await db
    .select({ sourceIdeaId: contentCalendarEntries.sourceIdeaId })
    .from(contentCalendarEntries)
    .where(
      and(
        eq(contentCalendarEntries.brandId, brandId),
        inArray(contentCalendarEntries.sourceIdeaId, ideaIds)
      )
    );

  return new Set(
    rows
      .map((row) => row.sourceIdeaId)
      .filter((sourceIdeaId): sourceIdeaId is string => !!sourceIdeaId)
  );
}

export async function getContentCalendarEntryById(
  entryId: string
): Promise<ContentCalendarEntry | null> {
  const [entry] = await db
    .select()
    .from(contentCalendarEntries)
    .where(eq(contentCalendarEntries.id, entryId))
    .limit(1);
  if (!entry) return null;

  const statusByEntryId = await getDerivedEntryStatus([entry]);
  const derivedStatus = statusByEntryId.get(entry.id);
  if (!derivedStatus || derivedStatus === entry.status) return entry;
  return {
    ...entry,
    status: derivedStatus,
  };
}

export async function getOpenContentCalendarTasksForEntry(
  entryId: string
): Promise<ContentCalendarGenerationTask[]> {
  return db
    .select()
    .from(contentCalendarGenerationTasks)
    .where(
      and(
        eq(contentCalendarGenerationTasks.entryId, entryId),
        inArray(contentCalendarGenerationTasks.status, ["queued", "running"])
      )
    )
    .orderBy(asc(contentCalendarGenerationTasks.queuedAt));
}

export async function createContentCalendarEntry(
  input: CreateContentCalendarEntryInput
): Promise<ContentCalendarEntry> {
  const normalizedFlowContext = normalizeAndValidateFlowContext({
    entryType: input.entryType,
    flowId: input.flowId ?? null,
    flowName: input.flowName ?? null,
    targetMessageId: input.targetMessageId ?? null,
  });

  const row: NewContentCalendarEntry = {
    brandId: input.brandId,
    sourceIdeaId: input.sourceIdeaId ?? null,
    entryType: input.entryType,
    title: input.title,
    ideaText: input.ideaText,
    suggestedPrompt: input.suggestedPrompt,
    emailPlan: input.emailPlan ?? null,
    plannedDate: input.plannedDate,
    flowId: normalizedFlowContext.flowId,
    flowName: normalizedFlowContext.flowName,
    targetMessageId: normalizedFlowContext.targetMessageId,
    createdByUserId: input.createdByUserId ?? null,
    source: input.source ?? "manual",
    sourceMetadata: input.sourceMetadata ?? null,
    autoGenerate: input.autoGenerate ?? true,
  };

  const [entry] = await db
    .insert(contentCalendarEntries)
    .values(row)
    .returning();
  return entry;
}

export async function updateContentCalendarEntry(
  entryId: string,
  input: UpdateContentCalendarEntryInput
): Promise<ContentCalendarEntry | null> {
  const existing = await getContentCalendarEntryById(entryId);
  if (!existing) {
    return null;
  }

  const nextEntryType = input.entryType ?? existing.entryType;
  const nextFlowContext = normalizeAndValidateFlowContext({
    entryType: nextEntryType,
    flowId: input.flowId !== undefined ? input.flowId : existing.flowId,
    flowName: input.flowName !== undefined ? input.flowName : existing.flowName,
    targetMessageId:
      input.targetMessageId !== undefined
        ? input.targetMessageId
        : existing.targetMessageId,
  });

  const patch: Partial<NewContentCalendarEntry> = {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.ideaText !== undefined ? { ideaText: input.ideaText } : {}),
    ...(input.suggestedPrompt !== undefined
      ? { suggestedPrompt: input.suggestedPrompt }
      : {}),
    ...(input.plannedDate !== undefined
      ? { plannedDate: input.plannedDate }
      : {}),
    ...(input.emailPlan !== undefined ? { emailPlan: input.emailPlan } : {}),
    flowId: nextFlowContext.flowId,
    flowName: nextFlowContext.flowName,
    targetMessageId: nextFlowContext.targetMessageId,
    entryType: nextEntryType,
    ...(input.autoGenerate !== undefined
      ? { autoGenerate: input.autoGenerate }
      : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    updatedAt: new Date(),
  };

  const [entry] = await db
    .update(contentCalendarEntries)
    .set(patch)
    .where(eq(contentCalendarEntries.id, entryId))
    .returning();

  return entry ?? null;
}

export async function deleteContentCalendarEntry(
  entryId: string
): Promise<ContentCalendarEntry | null> {
  const [entry] = await db
    .delete(contentCalendarEntries)
    .where(eq(contentCalendarEntries.id, entryId))
    .returning();
  return entry ?? null;
}

export async function createCalendarEntryFromIdea(input: {
  ideaId: string;
  plannedDate?: Date;
  createdByUserId?: string | null;
}): Promise<ContentCalendarEntry> {
  const idea = await getIdeaById(input.ideaId);
  if (!idea) {
    throw new Error("Idea not found");
  }

  const mappedType: ContentCalendarEntryType =
    idea.category === "campaign" ? "campaign" : "flow_improvement";
  const plannedDate =
    input.plannedDate ??
    idea.suggestedSendDate ??
    new Date(Date.now() + 24 * 60 * 60 * 1000);

  const title = idea.title;
  const ideaText = [idea.description, idea.relevanceReason]
    .filter(Boolean)
    .join("\n\n");

  const [existing] = await db
    .select()
    .from(contentCalendarEntries)
    .where(
      and(
        eq(contentCalendarEntries.sourceIdeaId, idea.id),
        eq(contentCalendarEntries.brandId, idea.brandId),
        eq(contentCalendarEntries.plannedDate, plannedDate)
      )
    )
    .limit(1);

  if (existing) {
    return existing;
  }

  return createContentCalendarEntry({
    brandId: idea.brandId,
    sourceIdeaId: idea.id,
    entryType: mappedType,
    title,
    ideaText,
    suggestedPrompt: idea.suggestedPrompt,
    plannedDate,
    flowId: idea.flowId,
    flowName: idea.flowName,
    targetMessageId: idea.targetMessageId,
    createdByUserId: input.createdByUserId ?? null,
    source: "idea",
    sourceMetadata: {
      ideaCategory: idea.category,
      recommendationType: idea.recommendationType,
    },
    emailPlan: {
      hook:
        (idea.creativeBrief as Record<string, unknown> | null)?.hook ?? null,
      graphic:
        (idea.creativeBrief as Record<string, unknown> | null)?.graphic ?? null,
      offer:
        (idea.creativeBrief as Record<string, unknown> | null)?.offer ?? null,
      context:
        (idea.creativeBrief as Record<string, unknown> | null)?.context ?? null,
    },
  });
}

export async function queueContentCalendarEntryGeneration(
  input: QueueGenerationInput
): Promise<ContentCalendarGenerationTask | null> {
  const entry = await getContentCalendarEntryById(input.entryId);
  if (!entry) {
    throw new Error("Calendar entry not found");
  }

  const [existingOpenTask] = await db
    .select()
    .from(contentCalendarGenerationTasks)
    .where(
      and(
        eq(contentCalendarGenerationTasks.entryId, input.entryId),
        inArray(contentCalendarGenerationTasks.status, ["queued", "running"])
      )
    )
    .limit(1);

  if (existingOpenTask) {
    const nextEntryStatus: ContentCalendarEntryStatus =
      existingOpenTask.status === "running" ? "generating" : "queued";
    if (entry.status !== nextEntryStatus) {
      await db
        .update(contentCalendarEntries)
        .set({
          status: nextEntryStatus,
          updatedAt: new Date(),
        })
        .where(eq(contentCalendarEntries.id, entry.id));
    }
    return existingOpenTask;
  }

  if (
    entry.generatedChatId &&
    (entry.status === "generated" ||
      entry.status === "generating" ||
      entry.status === "queued")
  ) {
    return null;
  }

  const [task] = await db
    .insert(contentCalendarGenerationTasks)
    .values({
      entryId: input.entryId,
      brandId: entry.brandId,
      triggerType: input.triggerType,
      requestedByUserId: input.requestedByUserId ?? null,
      status: "queued",
    })
    .returning();

  await db
    .update(contentCalendarEntries)
    .set({
      status: "queued",
      updatedAt: new Date(),
    })
    .where(eq(contentCalendarEntries.id, entry.id));

  return task;
}

export async function queueContentCalendarMonthGeneration(input: {
  brandId: string;
  year: number;
  month: number;
  requestedByUserId?: string | null;
  triggerType: string;
}): Promise<ContentCalendarGenerationTask[]> {
  const { start, end } = getMonthBounds(input.year, input.month);
  return queueContentCalendarDateRangeGeneration({
    brandId: input.brandId,
    start,
    end,
    requestedByUserId: input.requestedByUserId ?? null,
    triggerType: input.triggerType,
  });
}

export async function queueContentCalendarDateRangeGeneration(input: {
  brandId: string;
  start: Date;
  end: Date;
  requestedByUserId?: string | null;
  triggerType: string;
}): Promise<ContentCalendarGenerationTask[]> {
  const entries = await db
    .select()
    .from(contentCalendarEntries)
    .where(
      and(
        eq(contentCalendarEntries.brandId, input.brandId),
        gte(contentCalendarEntries.plannedDate, input.start),
        lt(contentCalendarEntries.plannedDate, input.end),
        inArray(contentCalendarEntries.status, ["planned", "failed", "queued"]),
        isNull(contentCalendarEntries.generatedChatId)
      )
    )
    .orderBy(asc(contentCalendarEntries.plannedDate));

  const queued: ContentCalendarGenerationTask[] = [];
  for (const entry of entries) {
    const task = await queueContentCalendarEntryGeneration({
      entryId: entry.id,
      triggerType: input.triggerType,
      requestedByUserId: input.requestedByUserId ?? null,
    });
    if (task) queued.push(task);
  }

  return queued;
}

export async function getAutoGenerateEntriesForWindow(
  start: Date,
  end: Date
): Promise<ContentCalendarEntry[]> {
  return db
    .select()
    .from(contentCalendarEntries)
    .where(
      and(
        gte(contentCalendarEntries.plannedDate, start),
        lt(contentCalendarEntries.plannedDate, end),
        eq(contentCalendarEntries.autoGenerate, true),
        inArray(contentCalendarEntries.status, ["planned", "failed", "queued"]),
        isNull(contentCalendarEntries.generatedChatId)
      )
    )
    .orderBy(asc(contentCalendarEntries.plannedDate));
}

export async function attachWorkflowRunToTask(
  taskId: string,
  runId: string
): Promise<void> {
  await db
    .update(contentCalendarGenerationTasks)
    .set({ workflowRunId: runId, updatedAt: new Date() })
    .where(eq(contentCalendarGenerationTasks.id, taskId));
}

export async function getQueuedContentCalendarTasks(
  limit = 200
): Promise<ContentCalendarGenerationTask[]> {
  return db
    .select()
    .from(contentCalendarGenerationTasks)
    .where(
      and(
        eq(contentCalendarGenerationTasks.status, "queued"),
        isNull(contentCalendarGenerationTasks.workflowRunId)
      )
    )
    .orderBy(asc(contentCalendarGenerationTasks.queuedAt))
    .limit(limit);
}

export async function getQueuedContentCalendarBacklogStats(): Promise<QueuedContentCalendarBacklogStats> {
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
      oldestQueuedAt: sql<Date | null>`min(${contentCalendarGenerationTasks.queuedAt})`,
    })
    .from(contentCalendarGenerationTasks)
    .where(
      and(
        eq(contentCalendarGenerationTasks.status, "queued"),
        isNull(contentCalendarGenerationTasks.workflowRunId)
      )
    )
    .limit(1);

  return {
    count: row?.count ?? 0,
    oldestQueuedAt: row?.oldestQueuedAt ?? null,
  };
}

export async function getQueuedContentCalendarBacklogStatsForBrand(
  brandId: string
): Promise<QueuedContentCalendarBacklogStats> {
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
      oldestQueuedAt: sql<Date | null>`min(${contentCalendarGenerationTasks.queuedAt})`,
    })
    .from(contentCalendarGenerationTasks)
    .where(
      and(
        eq(contentCalendarGenerationTasks.brandId, brandId),
        eq(contentCalendarGenerationTasks.status, "queued"),
        isNull(contentCalendarGenerationTasks.workflowRunId)
      )
    )
    .limit(1);

  return {
    count: row?.count ?? 0,
    oldestQueuedAt: row?.oldestQueuedAt ?? null,
  };
}

export async function getContentCalendarRecentTaskStats(
  brandId?: string,
  now = new Date()
): Promise<ContentCalendarRecentTaskStats> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const runningWhere = brandId
    ? and(
        eq(contentCalendarGenerationTasks.brandId, brandId),
        eq(contentCalendarGenerationTasks.status, "running")
      )
    : eq(contentCalendarGenerationTasks.status, "running");

  const startedWhere = brandId
    ? and(
        eq(contentCalendarGenerationTasks.brandId, brandId),
        gte(contentCalendarGenerationTasks.startedAt, since)
      )
    : gte(contentCalendarGenerationTasks.startedAt, since);

  const completedWhere = brandId
    ? and(
        eq(contentCalendarGenerationTasks.brandId, brandId),
        eq(contentCalendarGenerationTasks.status, "completed"),
        gte(contentCalendarGenerationTasks.completedAt, since)
      )
    : and(
        eq(contentCalendarGenerationTasks.status, "completed"),
        gte(contentCalendarGenerationTasks.completedAt, since)
      );

  const failedWhere = brandId
    ? and(
        eq(contentCalendarGenerationTasks.brandId, brandId),
        eq(contentCalendarGenerationTasks.status, "failed"),
        gte(contentCalendarGenerationTasks.completedAt, since)
      )
    : and(
        eq(contentCalendarGenerationTasks.status, "failed"),
        gte(contentCalendarGenerationTasks.completedAt, since)
      );

  const [runningRow, startedRow, completedRow, failedRow] = await Promise.all([
    db
      .select({
        count: sql<number>`count(*)::int`,
      })
      .from(contentCalendarGenerationTasks)
      .where(runningWhere)
      .limit(1),
    db
      .select({
        count: sql<number>`count(*)::int`,
      })
      .from(contentCalendarGenerationTasks)
      .where(startedWhere)
      .limit(1),
    db
      .select({
        count: sql<number>`count(*)::int`,
      })
      .from(contentCalendarGenerationTasks)
      .where(completedWhere)
      .limit(1),
    db
      .select({
        count: sql<number>`count(*)::int`,
      })
      .from(contentCalendarGenerationTasks)
      .where(failedWhere)
      .limit(1),
  ]);

  return {
    runningCount: runningRow[0]?.count ?? 0,
    startedLast24h: startedRow[0]?.count ?? 0,
    completedLast24h: completedRow[0]?.count ?? 0,
    failedLast24h: failedRow[0]?.count ?? 0,
  };
}

export async function getContentCalendarMonitoringStateByKey(
  alertKey: string
): Promise<ContentCalendarMonitoringState | null> {
  const [state] = await db
    .select()
    .from(contentCalendarMonitoringState)
    .where(eq(contentCalendarMonitoringState.alertKey, alertKey))
    .limit(1);

  return state ?? null;
}

export async function updateContentCalendarMonitoringState(
  input: UpdateContentCalendarMonitoringStateInput
): Promise<UpdateContentCalendarMonitoringStateResult> {
  const now = input.now ?? new Date();
  const fingerprint = input.fingerprint ?? null;

  return db.transaction(async (tx) => {
    const [existingRow] = await tx
      .select()
      .from(contentCalendarMonitoringState)
      .where(eq(contentCalendarMonitoringState.alertKey, input.alertKey))
      .limit(1);

    if (!existingRow) {
      const seed: NewContentCalendarMonitoringState = {
        alertKey: input.alertKey,
        severity: "healthy",
        isActive: false,
        consecutiveCount: 0,
      };
      await tx
        .insert(contentCalendarMonitoringState)
        .values(seed)
        .onConflictDoNothing();
    }

    const [previousState] = await tx
      .select()
      .from(contentCalendarMonitoringState)
      .where(eq(contentCalendarMonitoringState.alertKey, input.alertKey))
      .limit(1);

    if (!previousState) {
      throw new Error(
        `Failed to load monitoring state for key: ${input.alertKey}`
      );
    }

    const wasActive = previousState.isActive;
    const wasCritical = previousState.severity === "critical";
    const becameCritical =
      input.isActive && input.severity === "critical" && !wasCritical;
    const fingerprintChanged =
      (previousState.lastFingerprint ?? null) !== fingerprint;
    const lastSentAt = previousState.lastNotificationSentAt?.getTime() ?? null;
    const cooldownElapsed =
      lastSentAt === null ||
      now.getTime() - lastSentAt >= input.notificationCooldownMs;

    const shouldNotifyCritical =
      input.isActive &&
      input.severity === "critical" &&
      (!wasActive || becameCritical || fingerprintChanged || cooldownElapsed);
    const shouldSendResolution = wasActive && !input.isActive;
    const nextConsecutiveCount = input.isActive
      ? wasActive
        ? previousState.consecutiveCount + 1
        : 1
      : 0;

    const [updated] = await tx
      .update(contentCalendarMonitoringState)
      .set({
        severity: input.severity,
        isActive: input.isActive,
        lastFingerprint: fingerprint,
        lastTriggeredAt: input.isActive
          ? now
          : (previousState.lastTriggeredAt ?? null),
        lastResolvedAt: shouldSendResolution
          ? now
          : (previousState.lastResolvedAt ?? null),
        lastNotificationSentAt: shouldNotifyCritical
          ? now
          : (previousState.lastNotificationSentAt ?? null),
        consecutiveCount: nextConsecutiveCount,
        metadata: input.metadata ?? null,
        updatedAt: now,
      })
      .where(eq(contentCalendarMonitoringState.alertKey, input.alertKey))
      .returning();

    if (!updated) {
      throw new Error(
        `Failed to update monitoring state for key: ${input.alertKey}`
      );
    }

    return {
      state: updated,
      shouldNotifyCritical,
      shouldSendResolution,
    };
  });
}

export async function getContentCalendarTaskContext(taskId: string): Promise<{
  task: ContentCalendarGenerationTask;
  entry: ContentCalendarEntry;
} | null> {
  const [row] = await db
    .select({
      task: contentCalendarGenerationTasks,
      entry: contentCalendarEntries,
    })
    .from(contentCalendarGenerationTasks)
    .innerJoin(
      contentCalendarEntries,
      eq(contentCalendarGenerationTasks.entryId, contentCalendarEntries.id)
    )
    .where(eq(contentCalendarGenerationTasks.id, taskId))
    .limit(1);

  if (!row) return null;
  return row;
}

export async function markContentCalendarTaskRunning(
  taskId: string
): Promise<void> {
  await db.transaction(async (tx) => {
    const [task] = await tx
      .update(contentCalendarGenerationTasks)
      .set({
        status: "running",
        startedAt: new Date(),
        attemptCount: sql`${contentCalendarGenerationTasks.attemptCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(contentCalendarGenerationTasks.id, taskId))
      .returning();

    if (!task) return;

    await tx
      .update(contentCalendarEntries)
      .set({ status: "generating", updatedAt: new Date() })
      .where(eq(contentCalendarEntries.id, task.entryId));
  });
}

export async function markContentCalendarTaskCompleted(input: {
  taskId: string;
  generatedChatId: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [task] = await tx
      .update(contentCalendarGenerationTasks)
      .set({
        status: "completed",
        completedAt: new Date(),
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(contentCalendarGenerationTasks.id, input.taskId))
      .returning();

    if (!task) return;

    // Get the entry to check if it's an agent entry
    const [entry] = await tx
      .select()
      .from(contentCalendarEntries)
      .where(eq(contentCalendarEntries.id, task.entryId))
      .limit(1);

    if (!entry) return;

    // For agent entries, skip setting generatedChatId — winner is
    // determined after scoring via selectVersionWinner()
    const isAgentEntry = entry.agentWeekId != null;

    await tx
      .update(contentCalendarEntries)
      .set({
        status: "generated",
        ...(isAgentEntry ? {} : { generatedChatId: input.generatedChatId }),
        lastGeneratedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(contentCalendarEntries.id, task.entryId));
  });
}

export async function markContentCalendarTaskFailed(input: {
  taskId: string;
  errorMessage: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [task] = await tx
      .update(contentCalendarGenerationTasks)
      .set({
        status: "failed",
        completedAt: new Date(),
        errorMessage: input.errorMessage,
        updatedAt: new Date(),
      })
      .where(eq(contentCalendarGenerationTasks.id, input.taskId))
      .returning();

    if (!task) return;

    await tx
      .update(contentCalendarEntries)
      .set({
        status: "failed",
        updatedAt: new Date(),
      })
      .where(eq(contentCalendarEntries.id, task.entryId));
  });
}
