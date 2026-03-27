import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/main/client";
import { contentCalendarEntries } from "@/db/main/schema";
import { eq, and } from "drizzle-orm";
import { getAgentWeek, updateWeekStatus } from "@/db/main/agent-service";
import { createAndScheduleKlaviyoCampaign } from "@/lib/integrations/klaviyo/klaviyo-campaign-creation";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ weekId: string }> }
) {
  const { weekId } = await params;
  const body = await request.json().catch(() => ({}));

  try {
    const week = await getAgentWeek(weekId);
    if (!week) {
      return NextResponse.json({ error: "Week not found" }, { status: 404 });
    }

    if (week.status !== "approved" && week.status !== "reviewing" && week.status !== "generated") {
      return NextResponse.json(
        { error: `Cannot schedule week in status "${week.status}"` },
        { status: 400 }
      );
    }

    // Get entries selected for send
    const selectedEntries = await db
      .select()
      .from(contentCalendarEntries)
      .where(
        and(
          eq(contentCalendarEntries.agentWeekId, weekId),
          eq(contentCalendarEntries.isSelectedForSend, true)
        )
      );

    if (selectedEntries.length === 0) {
      return NextResponse.json(
        { error: "No entries selected for send" },
        { status: 400 }
      );
    }

    await updateWeekStatus(weekId, "scheduling");

    const results: Array<{
      entryId: string;
      campaignId: string;
      templateId: string;
      error?: string;
    }> = [];

    for (const entry of selectedEntries) {
      try {
        // Use explicit sendDatetime > entry's plannedDate > week's Monday at 10am UTC
        const fallbackDate = new Date(week.weekOf);
        fallbackDate.setUTCHours(10, 0, 0, 0);
        const sendDatetime =
          body.sendDatetime ?? entry.plannedDate?.toISOString() ?? fallbackDate.toISOString();

        const result = await createAndScheduleKlaviyoCampaign({
          brandId: entry.brandId,
          entryId: entry.id,
          sendDatetime,
        });

        results.push({
          entryId: entry.id,
          campaignId: result.campaignId,
          templateId: result.templateId,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Scheduling failed";
        results.push({
          entryId: entry.id,
          campaignId: "",
          templateId: "",
          error: message,
        });
      }
    }

    const allSucceeded = results.every((r) => !r.error);
    await updateWeekStatus(
      weekId,
      allSucceeded ? "scheduled" : "error",
      allSucceeded ? undefined : `${results.filter((r) => r.error).length} of ${results.length} campaigns failed to schedule`
    );

    return NextResponse.json({
      scheduled: results.filter((r) => !r.error).length,
      failed: results.filter((r) => r.error).length,
      results,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Scheduling failed";
    await updateWeekStatus(weekId, "error", message).catch(() => {});
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
