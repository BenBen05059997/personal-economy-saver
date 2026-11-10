import { z } from "zod";
import { BriefAuthor, BriefSchema } from "@/lib/agent/brief";

export const DeviceBriefSchema = z.object({
  id: z.string().uuid(),
  brief: BriefSchema,
  updatedAt: z.string().datetime(),
  updatedBy: BriefAuthor,
}).strict();
export type DeviceBrief = z.infer<typeof DeviceBriefSchema>;
