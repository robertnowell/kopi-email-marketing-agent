import { createEmailBatch } from "@/features/email-templates/templates/server/create-email-batch";
import { createEmptyMediaPlan } from "@/features/email-templates/templates/email-media-plan";
import { getBrandById, getBrandMembers } from "@/db/main/brands-service";
import {
  getContentCalendarTaskContext,
  markContentCalendarTaskCompleted,
  markContentCalendarTaskFailed,
  markContentCalendarTaskRunning,
} from "@/db/main/content-calendar-service";
import { createEntryVersion } from "@/db/main/agent-service";
import { searchEmailTemplatesByRelevance } from "@/db/main/brand-asset-embeddings";
import { linkIdeaToEmail } from "@/db/main/ideas-service";
import type { ReferenceEmailInput } from "@/workflows/contracts/email-generation";

function toPlainError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function markCalendarTaskRunningStep(taskId: string) {
  "use step";
  await markContentCalendarTaskRunning(taskId);
}

export async function generateCalendarEmailStep(taskId: string) {
  "use step";

  const context = await getContentCalendarTaskContext(taskId);
  if (!context) {
    throw new Error(`Calendar task ${taskId} not found`);
  }

  const { task, entry } = context;
  const brand = await getBrandById(entry.brandId);
  if (!brand) {
    throw new Error(`Brand ${entry.brandId} not found`);
  }

  const members = await getBrandMembers(brand.id);
  const admin = members.find((member) => member.role === "admin");
  const fallbackMember = members[0];
  const actorUserId =
    task.requestedByUserId ?? admin?.userId ?? fallbackMember?.userId ?? "calendar-bot";

  const isAgentEntry = entry.agentWeekId != null;

  if (isAgentEntry) {
    return generateAgentEntryVersions({
      taskId,
      entry,
      brand,
      actorUserId,
    });
  }

  // Standard calendar path: 1 chat per entry
  const result = await createEmailBatch({
    prompt: entry.suggestedPrompt,
    mediaPlan: createEmptyMediaPlan(),
    selectedAssets: [],
    brand,
    mode: "create",
    user: {
      displayName: "Content Calendar Automation",
      email: null,
      uid: actorUserId,
    },
    userId: actorUserId,
    includeBlankVersion: true,
    referenceEmails: [],
    selectedProductDbIds: [],
    experiment: null,
    fromIdeaId: entry.sourceIdeaId ?? undefined,
    fromCalendarEntryId: entry.id,
  });

  const generatedChatId = result.results[0]?.chatId;
  if (!generatedChatId) {
    throw new Error(`Calendar task ${taskId} did not produce a chat`);
  }

  return {
    generatedChatId,
    entryId: entry.id,
    brandId: entry.brandId,
  };
}

/**
 * Agent entry generation: creates 2 versions (A + B).
 *
 * Version A = fresh from prompt.
 * Version B = template rewrite of best matching existing email
 *             (via embedding similarity), or a different creative angle
 *             if no templates exist.
 */
async function generateAgentEntryVersions(input: {
  taskId: string;
  entry: {
    id: string;
    brandId: string;
    suggestedPrompt: string;
    sourceIdeaId: string | null;
    emailPlan: Record<string, unknown> | null;
  };
  brand: any;
  actorUserId: string;
}): Promise<{
  generatedChatId: string;
  entryId: string;
  brandId: string;
}> {
  const { entry, brand, actorUserId } = input;

  const userObj = {
    displayName: "Marketing Agent",
    email: null,
    uid: actorUserId,
  };

  const baseInput = {
    mediaPlan: createEmptyMediaPlan(),
    selectedAssets: [],
    brand,
    mode: "create" as const,
    user: userObj,
    userId: actorUserId,
    selectedProductDbIds: [],
    fromIdeaId: entry.sourceIdeaId ?? undefined,
    fromCalendarEntryId: entry.id,
    experiment: {
      enableCritiqueLoop: true,
      minCritiqueScore: 70,
      maxAttempts: 2,
    },
  };

  // Try to find a relevant existing template for version B
  let referenceEmail: ReferenceEmailInput | undefined;
  let versionBAngle = "fresh (different creative angle)";

  try {
    const templateSearch = await searchEmailTemplatesByRelevance({
      brandId: entry.brandId,
      query: entry.suggestedPrompt,
      limit: 1,
      starredOnly: true,
    });

    if (templateSearch.emails.length > 0) {
      const bestMatch = templateSearch.emails[0];
      if (bestMatch.messageId) {
        referenceEmail = {
          chatId: bestMatch.chatId,
          messageId: bestMatch.messageId,
          title: bestMatch.title,
        };
        versionBAngle = `rewrite of "${bestMatch.title}"`;
      }
    }
  } catch (error) {
    // Template search failed — fall back to 2 fresh versions
    console.warn("[AgentGeneration] Template search failed, using 2 fresh versions:", error);
  }

  if (referenceEmail) {
    // Version A (fresh) + Version B (template rewrite) in one batch call
    const result = await createEmailBatch({
      ...baseInput,
      prompt: entry.suggestedPrompt,
      includeBlankVersion: true,
      referenceEmails: [referenceEmail],
    });

    const versionAChatId = result.results.find((r) => !r.referenceEmail)?.chatId;
    const versionBChatId = result.results.find((r) => r.referenceEmail)?.chatId;

    if (versionAChatId) {
      await createEntryVersion({
        entryId: entry.id,
        chatId: versionAChatId,
        versionLabel: "A",
        creativeAngle: "fresh",
      });
    }

    if (versionBChatId) {
      await createEntryVersion({
        entryId: entry.id,
        chatId: versionBChatId,
        versionLabel: "B",
        creativeAngle: versionBAngle,
      });
    }

    // Mark the source idea as created (link to version A's chat)
    if (entry.sourceIdeaId && (versionAChatId ?? versionBChatId)) {
      await linkIdeaToEmail(entry.sourceIdeaId, (versionAChatId ?? versionBChatId)!);
    }

    return {
      generatedChatId: versionAChatId ?? versionBChatId ?? "",
      entryId: entry.id,
      brandId: entry.brandId,
    };
  }

  // No template found — create 2 fresh versions with different angles
  const emailPlan = entry.emailPlan as {
    hook?: string;
    graphic?: string;
    offer?: string;
    context?: string;
  } | null;

  const resultA = await createEmailBatch({
    ...baseInput,
    prompt: entry.suggestedPrompt,
    includeBlankVersion: true,
    referenceEmails: [],
  });

  // Version B: vary the creative direction
  const altAngle = emailPlan?.offer
    ? `Lead with the offer: ${emailPlan.offer}. Take a completely different visual and tonal approach from the default.`
    : "Take a completely different creative angle — different tone, different visual direction, different hook.";

  const resultB = await createEmailBatch({
    ...baseInput,
    prompt: `${altAngle}\n\n${entry.suggestedPrompt}`,
    includeBlankVersion: true,
    referenceEmails: [],
  });

  const chatIdA = resultA.results[0]?.chatId;
  const chatIdB = resultB.results[0]?.chatId;

  if (chatIdA) {
    await createEntryVersion({
      entryId: entry.id,
      chatId: chatIdA,
      versionLabel: "A",
      creativeAngle: "fresh",
    });
  }

  if (chatIdB) {
    await createEntryVersion({
      entryId: entry.id,
      chatId: chatIdB,
      versionLabel: "B",
      creativeAngle: "fresh (alternate angle)",
    });
  }

  // Mark the source idea as created (link to version A's chat)
  if (entry.sourceIdeaId && (chatIdA ?? chatIdB)) {
    await linkIdeaToEmail(entry.sourceIdeaId, (chatIdA ?? chatIdB)!);
  }

  return {
    generatedChatId: chatIdA ?? chatIdB ?? "",
    entryId: entry.id,
    brandId: entry.brandId,
  };
}

export async function markCalendarTaskCompletedStep(input: {
  taskId: string;
  generatedChatId: string;
}) {
  "use step";
  await markContentCalendarTaskCompleted(input);
}

export async function markCalendarTaskFailedStep(input: {
  taskId: string;
  error: unknown;
}) {
  "use step";
  await markContentCalendarTaskFailed({
    taskId: input.taskId,
    errorMessage: toPlainError(input.error),
  });
}
