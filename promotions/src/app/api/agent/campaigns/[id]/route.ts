import { NextRequest, NextResponse } from "next/server";
import { selectVersionWinner } from "@/db/main/agent-service";
import { db } from "@/db/main/client";
import { contentCalendarEntries } from "@/db/main/schema";
import { eq } from "drizzle-orm";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: entryId } = await params;
  const body = await request.json();

  try {
    if (body.selectedVersionId) {
      await selectVersionWinner(entryId, body.selectedVersionId);
      return NextResponse.json({ success: true });
    }

    if (body.isSelectedForSend !== undefined) {
      await db
        .update(contentCalendarEntries)
        .set({
          isSelectedForSend: body.isSelectedForSend,
          updatedAt: new Date(),
        })
        .where(eq(contentCalendarEntries.id, entryId));
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "No action specified" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Update failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
