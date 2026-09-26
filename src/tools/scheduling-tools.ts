import { tool } from "ai";
import { scheduleSchema } from "agents/schedule";
import { z } from "zod";
import type { SchedulingToolContext } from "../types";

/** AI SDK tools for creating, listing, and cancelling scheduled tasks. */
export function createSchedulingTools(context: SchedulingToolContext) {
  return {
    scheduleTask: tool({
      description:
        "Schedule a task to be executed at a later time. Use this when the user asks to be reminded or wants something done later.",
      inputSchema: scheduleSchema,
      execute: async ({ when, description }) => {
        if (when.type === "no-schedule") {
          return "Not a valid schedule input";
        }

        const input =
          when.type === "scheduled"
            ? when.date
            : when.type === "delayed"
              ? when.delayInSeconds
              : when.type === "cron"
                ? when.cron
                : null;
        if (!input) return "Invalid schedule type";

        try {
          await context.schedule(input, description);
          return `Task scheduled: "${description}" (${when.type}: ${input})`;
        } catch (error) {
          return `Error scheduling task: ${error}`;
        }
      }
    }),

    getScheduledTasks: tool({
      description: "List all tasks that have been scheduled",
      inputSchema: z.object({}),
      execute: async () => {
        const tasks = context.getSchedules();
        return tasks.length > 0 ? tasks : "No scheduled tasks found.";
      }
    }),

    cancelScheduledTask: tool({
      description: "Cancel a scheduled task by its ID",
      inputSchema: z.object({
        taskId: z.string().describe("The ID of the task to cancel")
      }),
      execute: async ({ taskId }) => {
        try {
          const cancelled = await context.cancelSchedule(taskId);
          return cancelled
            ? `Task ${taskId} cancelled.`
            : `Task ${taskId} was not found.`;
        } catch (error) {
          return `Error cancelling task: ${error}`;
        }
      }
    })
  };
}
