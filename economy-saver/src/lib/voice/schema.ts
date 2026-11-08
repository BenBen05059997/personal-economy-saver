// Voice fill (28B): the one schema every form shares. A form is described by its own fields at the moment of the tap
// (the browser reads them), so no form is registered anywhere. The model only proposes; check.ts decides what is kept.
import { z } from "zod";

// The name is the form field's name and, later, a key of the model's tool input: keep it to characters every provider accepts.
const name = z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/);
const label = z.string().trim().min(1).max(80);
const required = z.boolean().optional();

export const FieldSpec = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), name, label, maxLength: z.number().int().min(1).max(1000).optional(), required }).strict(),
  z.object({ kind: z.literal("amount"), name, label, currency: z.string().min(1).max(8), signed: z.boolean().optional(), required }).strict(),
  z.object({ kind: z.literal("date"), name, label, min: z.string().date().optional(), max: z.string().date().optional(), required }).strict(),
  z.object({
    kind: z.literal("select"), name, label, required,
    options: z.array(z.object({ value: z.string().max(200), label: z.string().max(80) }).strict()).min(1).max(50),
  }).strict(),
  z.object({ kind: z.literal("check"), name, label, required }).strict(),
]);
export type FieldSpec = z.infer<typeof FieldSpec>;

export const VoiceFillRequest = z.object({
  text: z.string().trim().min(1).max(400),
  fields: z.array(FieldSpec).min(1).max(20),
}).strict().refine(r => new Set(r.fields.map(f => f.name)).size === r.fields.length, { message: "Field names must be unique." });
export type VoiceFillRequest = z.infer<typeof VoiceFillRequest>;

/** `values` holds only checked values as the form's own text: an amount as typed digits, a date as yyyy-mm-dd, a check as "on" or "". */
export const VoiceFillResponse = z.object({
  values: z.record(z.string(), z.string()),
  heard: z.string(),
  notes: z.array(z.string()),
});
export type VoiceFillResponse = z.infer<typeof VoiceFillResponse>;
