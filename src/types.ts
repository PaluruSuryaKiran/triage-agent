import type { Schedule } from "agents";

/** Durable Object schedule record passed to scheduled callbacks. */
export type ScheduledTask = Schedule<string>;

/** Accepted inputs for the Agent scheduling API. */
export type ScheduleInput = Date | string | number;

/** Server-side capabilities required by the scheduling tool factory. */
export interface SchedulingToolContext {
  schedule(when: ScheduleInput, description: string): Promise<ScheduledTask>;
  getSchedules(): ScheduledTask[];
  cancelSchedule(id: string): Promise<boolean>;
}
