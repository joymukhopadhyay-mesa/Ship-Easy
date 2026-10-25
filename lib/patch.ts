// The PATCH contract between an extractor (local regex or the model) and the booking.
// The extractor never sees or returns the booking; code merges the patch, enforcing:
//   - allow-list: only seller-supplied fields (inferred/computed fields are code-only)
//   - source check: every value carries the exact phrase from the LATEST user message
import { z } from "zod";

const Scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const SourcedValue = z.object({ value: Scalar, source: z.string() });

/** Seller-supplied booking fields the extractor may set. */
export const BOOKING_PATCH_FIELDS = [
  "sellerName",
  "originCity",
  "destinationCity",
  "destinationType",
  "readyDate",
  "priority",
  "pallets",
  "grossWeight",
  "appointmentBooked",
  "chosenCarrier",
] as const;

/** Seller-supplied item fields the extractor may set. */
export const ITEM_PATCH_FIELDS = [
  "description",
  "quantity",
  "unitPrice",
  "unitsPerCarton",
  "cartons",
  "unitWeight",
  "hsCode",
  "countryOfOrigin",
] as const;

/** Written by code only, never by an extractor. */
export const CODE_ONLY_FIELDS = ["originCountry", "destinationCountry", "currency", "declaredValue", "cartons@booking", "bookingId"] as const;

export const PatchSchema = z.object({
  set: z.record(z.string(), SourcedValue).default({}),
  items: z
    .array(
      z.object({
        op: z.enum(["add", "update", "remove"]),
        sku: z.string().nullable().optional(),
        fields: z.record(z.string(), SourcedValue).default({}),
      }),
    )
    .default([]),
  questions_answered: z.array(z.string()).default([]),
  /** Option key chosen for a pending multiple-choice question (e.g. "b"). */
  choice: z.object({ value: z.string(), source: z.string() }).nullable().optional(),
  /** Fields the seller explicitly declined ("don't know the HS code"). */
  declined: z.array(z.object({ field: z.string(), sku: z.string().nullable().optional(), source: z.string() })).default([]),
});

export type Patch = z.infer<typeof PatchSchema>;
export type SourcedValueT = z.infer<typeof SourcedValue>;

export const emptyPatch = (): Patch => ({ set: {}, items: [], questions_answered: [], choice: null, declined: [] });

const squash = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();

/** True if the phrase occurs in the message (case/whitespace-insensitive). */
export function sourceInMessage(source: string, message: string): boolean {
  const s = squash(source);
  return s.length > 0 && squash(message).includes(s);
}

export interface Rejection {
  field: string;
  value: unknown;
  source: string;
  reason: "not in latest message" | "field not allowed" | "invalid value";
}

/** Drops every value that fails the allow-list or the source check. Pure. */
export function sanitisePatch(patch: Patch, latestMessage: string): { patch: Patch; rejected: Rejection[] } {
  const rejected: Rejection[] = [];
  const out = emptyPatch();
  for (const [field, sv] of Object.entries(patch.set ?? {})) {
    if (!(BOOKING_PATCH_FIELDS as readonly string[]).includes(field)) { rejected.push({ field, value: sv.value, source: sv.source, reason: "field not allowed" }); continue; }
    if (!sourceInMessage(sv.source, latestMessage)) { rejected.push({ field, value: sv.value, source: sv.source, reason: "not in latest message" }); continue; }
    out.set[field] = sv;
  }
  for (const it of patch.items ?? []) {
    const fields: Record<string, SourcedValueT> = {};
    for (const [field, sv] of Object.entries(it.fields ?? {})) {
      if (!(ITEM_PATCH_FIELDS as readonly string[]).includes(field)) { rejected.push({ field: `item.${field}`, value: sv.value, source: sv.source, reason: "field not allowed" }); continue; }
      if (!sourceInMessage(sv.source, latestMessage)) { rejected.push({ field: `item.${field}`, value: sv.value, source: sv.source, reason: "not in latest message" }); continue; }
      fields[field] = sv;
    }
    if (it.op === "remove" || Object.keys(fields).length) out.items.push({ op: it.op, sku: it.sku ?? null, fields });
  }
  if (patch.choice && sourceInMessage(patch.choice.source, latestMessage)) out.choice = patch.choice;
  out.declined = (patch.declined ?? []).filter((d) => sourceInMessage(d.source, latestMessage));
  out.questions_answered = patch.questions_answered ?? [];
  return { patch: out, rejected };
}
