/**
 * Orchestrator for creating Klaviyo campaigns from agent-selected emails.
 *
 * Flow: render email HTML → create template → create campaign → get message ID → assign template
 */

import { db } from "@/db/main/client";
import {
  chat,
  message,
  messageArtifact,
  contentCalendarEntries,
  contentCalendarEntryVersions,
} from "@/db/main/schema";
import { eq, and } from "drizzle-orm";
import { getKlaviyoIntegration, getApiKey } from "@/db/main/klaviyo-service";
import { getAgentSettings } from "@/db/main/agent-service";
import { getBrandById } from "@/db/main/brands-service";
import { renderWandEmail } from "@/features/wand-editor/utils/render-wand";
import { render as renderReactEmail } from "@react-email/components";
import { preprocessEmailForScreenshot } from "@/features/wand-editor/utils/preprocess-email-server";
import { fixBrandVariablesWithBrand } from "@/features/editor/resolve-css-var-names";
import type { Email } from "@/features/wand-editor/components/types";
import { parseEmailScript } from "@/features/wand-editor/utils/email-script-parser";
import type { ChatMetadata, MessageMetadata } from "@/types/chat-types";
import {
  createKlaviyoTemplate,
  createKlaviyoCampaign,
  getKlaviyoCampaignWithMessages,
  assignTemplateToKlaviyoCampaignMessage,
  scheduleKlaviyoCampaign,
  listSegments,
} from "./klaviyo-client";

export interface CreateKlaviyoCampaignResult {
  campaignId: string;
  templateId: string;
  campaignMessageId: string;
}

/**
 * Create a Klaviyo draft campaign from an agent-selected calendar entry.
 *
 * Steps:
 * 1. Get winning version's chat + artifact
 * 2. Render email HTML (server-side)
 * 3. Create Klaviyo template with HTML
 * 4. Create Klaviyo campaign with inline message
 * 5. Extract campaign-message ID
 * 6. Assign template to campaign message
 * 7. Update chat metadata with Klaviyo export state
 */
export async function createAndScheduleKlaviyoCampaign(input: {
  brandId: string;
  entryId: string;
  sendDatetime: string;
}): Promise<CreateKlaviyoCampaignResult> {
  const { brandId, entryId, sendDatetime } = input;

  // 1. Get winning version
  const [winningVersion] = await db
    .select()
    .from(contentCalendarEntryVersions)
    .where(
      and(
        eq(contentCalendarEntryVersions.entryId, entryId),
        eq(contentCalendarEntryVersions.isSelected, true)
      )
    )
    .limit(1);

  if (!winningVersion?.chatId) {
    throw new Error(`No winning version found for entry ${entryId}`);
  }

  // Get the entry for title/context
  const [entry] = await db
    .select()
    .from(contentCalendarEntries)
    .where(eq(contentCalendarEntries.id, entryId))
    .limit(1);

  if (!entry) {
    throw new Error(`Calendar entry ${entryId} not found`);
  }

  // 2. Get chat + selected message + artifact
  const [chatRow] = await db
    .select()
    .from(chat)
    .where(eq(chat.id, winningVersion.chatId))
    .limit(1);

  if (!chatRow) {
    throw new Error(`Chat ${winningVersion.chatId} not found`);
  }

  const chatMeta = chatRow.metadata as ChatMetadata | null;
  const selectedMessageId = chatMeta?.selectedMessageId;

  if (!selectedMessageId) {
    throw new Error(`Chat ${winningVersion.chatId} has no selected message`);
  }

  const [msgRow] = await db
    .select()
    .from(message)
    .where(eq(message.id, selectedMessageId))
    .limit(1);

  if (!msgRow) {
    throw new Error(`Message ${selectedMessageId} not found`);
  }

  const [artifact] = await db
    .select()
    .from(messageArtifact)
    .where(eq(messageArtifact.messageId, selectedMessageId))
    .limit(1);

  if (!artifact?.parsed) {
    throw new Error(`No artifact found for message ${selectedMessageId}`);
  }

  // 3. Render email HTML (server-side, same pattern as screenshot generation)
  const brand = await getBrandById(brandId);
  if (!brand) {
    throw new Error(`Brand ${brandId} not found`);
  }

  let emailJson: Email;

  // Try parsed JSON first, fall back to parsing from raw XML
  const parsedValue = artifact.parsed && artifact.parsed !== "null"
    ? (typeof artifact.parsed === "string" ? JSON.parse(artifact.parsed) : artifact.parsed)
    : null;

  if (parsedValue?.rows) {
    emailJson = parsedValue;
  } else if (artifact.raw) {
    // Parse from raw XML (the canonical source)
    console.log(`[KlaviyoCampaign] parsed is null, falling back to raw XML for message ${selectedMessageId}`);
    emailJson = parseEmailScript(
      artifact.raw,
      brand.colors?.primary ?? "#000000",
      "default",
      false,
      brand
    );
  } else {
    throw new Error(
      `Email artifact for message ${selectedMessageId} has no parseable content. The email may not have finished generating.`
    );
  }
  const preprocessedEmail = await preprocessEmailForScreenshot(
    emailJson,
    brand
  );
  const renderedHtml = await renderWandEmail(renderReactEmail, {
    email: preprocessedEmail,
    exportType: "html",
    brand,
  });
  const finalHtml = fixBrandVariablesWithBrand(renderedHtml, brand);

  // 4. Get subject and preview text from message metadata
  const msgMeta = msgRow.metadata as MessageMetadata | null;
  const subject = chatRow.title || "Untitled Campaign";
  const previewText = chatMeta?.previewText || "";

  // 5. Resolve API key and segment
  const integration = await getKlaviyoIntegration(brandId);
  if (!integration) {
    throw new Error(`No Klaviyo integration found for brand ${brandId}`);
  }
  const apiKey = getApiKey(integration);

  const agentSettings = await getAgentSettings(brandId);
  let segmentId = agentSettings?.defaultSegmentId;
  if (!segmentId) {
    // Fallback: use first available Klaviyo segment
    const segments = await listSegments(apiKey);
    if (segments.length === 0) {
      throw new Error(
        `No segments found in Klaviyo account for brand ${brandId}`
      );
    }
    segmentId = segments[0].id;
    console.warn(
      `[KlaviyoCampaign] No default segment configured, using first segment: ${segments[0].name} (${segmentId})`
    );
  }

  // 6. Create template
  const campaignName = `[Kopi] ${subject}`;
  const { templateId } = await createKlaviyoTemplate(apiKey, {
    name: campaignName,
    html: finalHtml,
  });

  console.log(`[KlaviyoCampaign] Template created: ${templateId}`);

  // 7. Create campaign
  const { campaignId } = await createKlaviyoCampaign(apiKey, {
    name: campaignName,
    segmentId,
    subject,
    previewText,
    sendDatetime,
  });

  console.log(`[KlaviyoCampaign] Campaign created: ${campaignId}`);

  // 8. Get campaign message ID
  const { campaignMessageId } = await getKlaviyoCampaignWithMessages(
    apiKey,
    campaignId
  );

  console.log(`[KlaviyoCampaign] Campaign message ID: ${campaignMessageId}`);

  // 9. Assign template to campaign message
  await assignTemplateToKlaviyoCampaignMessage(apiKey, {
    campaignMessageId,
    templateId,
  });

  console.log(`[KlaviyoCampaign] Template assigned to campaign message`);

  // 10. Schedule the campaign (moves from Draft → Scheduled)
  let sendJobId: string | undefined;
  try {
    const sendJob = await scheduleKlaviyoCampaign(apiKey, campaignId);
    sendJobId = sendJob.sendJobId;
    console.log(`[KlaviyoCampaign] Campaign scheduled, sendJobId: ${sendJobId}`);
  } catch (scheduleError) {
    // Campaign is still a draft — log but don't fail the whole operation
    console.error(
      `[KlaviyoCampaign] Failed to schedule campaign ${campaignId}:`,
      scheduleError instanceof Error ? scheduleError.message : scheduleError
    );
  }

  // 11. Update chat metadata with Klaviyo export state
  const updatedMeta: ChatMetadata = {
    ...(chatMeta ?? {}),
    klaviyoExport: {
      campaignId,
      templateId,
      sendJobId,
      status: sendJobId ? "scheduled" : "draft",
      scheduledAt: sendDatetime,
    },
  };

  await db
    .update(chat)
    .set({ metadata: updatedMeta })
    .where(eq(chat.id, winningVersion.chatId));

  console.log(
    `[KlaviyoCampaign] Chat ${winningVersion.chatId} metadata updated with Klaviyo export`
  );

  return { campaignId, templateId, campaignMessageId };
}
