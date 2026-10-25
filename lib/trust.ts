// Field trust model (spec A3). Only MUTABLE fields may ever be proposed for correction.
import type { MutableField } from "./types";

export const MUTABLE_FIELDS: readonly MutableField[] = [
  "booking.pallets",
  "booking.cartons",
  "booking.declared_value",
  "booking.gross_weight",
  "item.hs_code",
  "item.quantity",
  "item.cartons",
] as const;

/** Never auto-corrected. */
export const TRUSTED_FIELDS = [
  "item.unit_price",
  "item.units_per_carton",
  "item.unit_weight",
  "booking.origin_city",
  "booking.origin_country",
  "booking.destination_city",
  "booking.destination_country",
  "booking.destination_type",
  "booking.ready_date",
  "booking.priority",
  "booking.appointment_booked",
] as const;

export type FieldKind = "count" | "money" | "weight" | "code";

export const FIELD_KIND: Record<MutableField, FieldKind> = {
  "booking.pallets": "count",
  "booking.cartons": "count",
  "booking.declared_value": "money",
  "booking.gross_weight": "weight",
  "item.hs_code": "code",
  "item.quantity": "count",
  "item.cartons": "count",
};

export const FIELD_LABEL: Record<MutableField, string> = {
  "booking.pallets": "Pallets",
  "booking.cartons": "Booking cartons",
  "booking.declared_value": "Declared value",
  "booking.gross_weight": "Gross weight",
  "item.hs_code": "HS code",
  "item.quantity": "Quantity",
  "item.cartons": "Item cartons",
};

export function isMutable(field: string): field is MutableField {
  return (MUTABLE_FIELDS as readonly string[]).includes(field);
}

export const BOOKING_LEVEL: MutableField[] = ["booking.declared_value", "booking.cartons", "booking.gross_weight"];
export const ITEM_LEVEL: MutableField[] = ["item.quantity", "item.cartons"];
