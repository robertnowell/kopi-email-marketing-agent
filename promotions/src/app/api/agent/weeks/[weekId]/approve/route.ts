import { NextRequest, NextResponse } from "next/server";
import { updateWeekStatus } from "@/db/main/agent-service";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ weekId: string }> }
) {
  const { weekId } = await params;

  try {
    await updateWeekStatus(weekId, "approved");
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Approve failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
