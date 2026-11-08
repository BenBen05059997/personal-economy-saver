import { z } from "zod";
import { BriefSchema } from "@/lib/agent/brief";

export const DeviceBriefSchema = z.object({
  id: z.string().uuid(),
  brief: BriefSchema,
  updatedAt: z.string().datetime(),
  updatedBy: z.enum(["ask", "form"]),
}).strict();
export type DeviceBrief = z.infer<typeof DeviceBriefSchema>;
