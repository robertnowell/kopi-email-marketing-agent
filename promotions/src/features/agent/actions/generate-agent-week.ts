"use server";

import {
  getAgentWeek,
  updateWeekStatus,
} from "@/db/main/agent-service";
import { queueContentCalendarEntryGeneration } from "@/db/main/content-calendar-service";
import {
  dispatchGenerationTasksWithConcurrency,
  type DispatchGenerationTaskRef,
} from "@/features/content-calendar/server/dispatch-generation-batch";

/**
 * Dispatch generation for all entries in an agent week.
 *
 * For each of the 5 calendar entries:
 *  - Queues a generation task (reuses calendar's queue function)
 *  - Dispatches the task to the workflow engine
 *
 * The generation step (generateCalendarEmailStep) detects agent entries
 * via entry.agentWeekId and creates 2 versions instead of 1.
 */
export async function generateAgentWeek(input: {
  weekId: string;
  requestedByUserId?: string;
}): Promise<{
  tasksDispatched: number;
  failures: number;
}> {
  const week = await getAgentWeek(input.weekId);
  if (!week) {
    throw new Error("Agent week not found");
  }

  if (
    week.status !== "ideas_selected" &&
    week.status !== "error" &&
    week.status !== "planning"
  ) {
    throw new Error(
      `Cannot generate week in status "${week.status}". Expected "ideas_selected".`
    );
  }

  if (week.entries.length === 0) {
    throw new Error("No entries in this agent week");
  }

  // Queue generation tasks for each entry
  const taskRefs: DispatchGenerationTaskRef[] = [];

  for (const entry of week.entries) {
    const task = await queueContentCalendarEntryGeneration({
      entryId: entry.id,
      triggerType: "agent",
      requestedByUserId: input.requestedByUserId ?? null,
    });

    if (task) {
      taskRefs.push({ id: task.id, brandId: entry.brandId });
    }
  }

  if (taskRefs.length === 0) {
    throw new Error("No tasks could be queued — entries may already be generated");
  }

  // Update week status to generating
  await updateWeekStatus(input.weekId, "generating");

  // Dispatch all tasks with concurrency control
  const result = await dispatchGenerationTasksWithConcurrency({
    tasks: taskRefs,
    concurrency: 3,
    startRetryAttempts: 3,
    startRetryBaseMs: 400,
  });

  if (result.failures.length > 0) {
    console.error(
      `[AgentWeek] ${result.failures.length} task(s) failed to dispatch:`,
      result.failures.map((f) => ({ taskId: f.taskId, error: f.error }))
    );
  }

  return {
    tasksDispatched: result.started.length,
    failures: result.failures.length,
  };
}
