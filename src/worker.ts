import { Hono } from "hono";
import { app } from "@wallabag/api";

const honoApp = app as Hono & {
  scheduled?: (event: ScheduledEvent, env: unknown, ctx: ExecutionContext) => Promise<void>;
  queue?: (batch: MessageBatch<unknown>, env: unknown, ctx: ExecutionContext) => Promise<void>;
};

export default {
  fetch: honoApp.fetch,
  scheduled: honoApp.scheduled,
  queue: honoApp.queue,
};
