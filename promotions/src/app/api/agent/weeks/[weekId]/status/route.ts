import { NextRequest, NextResponse } from "next/server";
import { pollAgentGeneration } from "@/features/agent/actions/poll-agent-generation";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ weekId: string }> }
) {
  const { weekId } = await params;

  try {
    const status = await pollAgentGeneration(weekId);
    return NextResponse.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Status check failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
