import { NextRequest, NextResponse } from "next/server";
import { generateAgentWeek } from "@/features/agent/actions/generate-agent-week";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ weekId: string }> }
) {
  const { weekId } = await params;
  const body = await request.json().catch(() => ({}));

  try {
    const result = await generateAgentWeek({
      weekId,
      requestedByUserId: body.requestedByUserId,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
