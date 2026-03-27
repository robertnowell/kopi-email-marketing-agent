import { NextRequest, NextResponse } from "next/server";
import { getAgentWeeks } from "@/db/main/agent-service";
import { selectIdeasForWeek } from "@/features/agent/actions/select-ideas-for-week";
import { pollAgentGeneration } from "@/features/agent/actions/poll-agent-generation";

export async function GET(request: NextRequest) {
  const brandId = request.nextUrl.searchParams.get("brandId");
  if (!brandId) {
    return NextResponse.json({ error: "brandId required" }, { status: 400 });
  }

  const limit = Number(request.nextUrl.searchParams.get("limit") ?? 10);
  let weeks = await getAgentWeeks(brandId, limit);

  // Run poll for weeks that need score extraction or status advancement
  const weeksNeedingPoll = weeks.filter((w) => {
    if (w.status === "generating") return true;
    // Also poll "generated" weeks that have versions missing scores
    if (w.status === "generated") {
      return w.entries.some((e) =>
        e.versions.some((v) => v.chatId && v.critiqueScore == null)
      );
    }
    return false;
  });

  if (weeksNeedingPoll.length > 0) {
    for (const week of weeksNeedingPoll) {
      try {
        await pollAgentGeneration(week.id);
      } catch {
        // Non-fatal — poll failure shouldn't block the GET
      }
    }
    // Re-fetch to get updated data
    weeks = await getAgentWeeks(brandId, limit);
  }

  return NextResponse.json({ weeks });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { brandId, weekOf, createdByUserId } = body;

  if (!brandId) {
    return NextResponse.json({ error: "brandId required" }, { status: 400 });
  }

  try {
    const result = await selectIdeasForWeek({
      brandId,
      weekOf: weekOf ? new Date(weekOf) : undefined, // auto-picks next unplanned week
      createdByUserId,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create week";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
