// Shared engine types. Pure data, no logic.

export type Priority = "Cheapest" | "Fastest" | "Most reliable" | "Balanced";
export type DestinationType = "Warehouse" | "Business address";
export type CarrierId = "A" | "B" | "C";
export type Severity = "Red" | "Amber";
export type RuleId = "R-01" | "R-02" | "R-03" | "R-04" | "R-05" | "R-06" | "R-07" | "R-08" | "R-09" | "R-10";
export type RuleStatus = "pass" | "fail" | "not_checked" | "cannot_compute";
export type Verdict = "BLOCKED" | "SHIP WITH CARE" | "CLEAR TO SHIP" | "INCOMPLETE";
export type GateCode = "D-01" | "D-02" | "D-03" | "D-04" | "D-05" | "D-06";
export type Confidence = "High" | "Possible" | "Ambiguous";
export type HazardKind = "explicit" | "implied" | "none";
export type R05State = "pass" | "no_carrier_fits" | "seller_override" | "cannot_compute";

export interface Quarantine {
  field: string;
  raw: string;
  reason: string;
}

export interface Item {
  /** Stable id within a booking (sheet row or chat line). */
  rowId: string;
  /** 1-based sheet row, when parsed from a file. */
  row?: number;
  sku: string;
  description: string;
  hsCode: string | null;
  quantity: number | null;
  unitPrice: number | null;
  unitsPerCarton: number | null;
  cartons: number | null;
  unitWeight: number | null;
  countryOfOrigin: string | null;
  /** R-06-I seller declaration, "DD-MM-YYYY HH:mm" Europe/London. */
  hazardConfirmedAt?: string | null;
  quarantined?: Quarantine[];
}

export interface Booking {
  bookingId: string;
  row?: number;
  sellerName: string | null;
  originCity: string | null;
  originCountry: string | null;
  destinationCity: string | null;
  destinationCountry: string | null;
  destinationType: DestinationType | null;
  /** ISO YYYY-MM-DD */
  readyDate: string | null;
  priority: Priority | null;
  pallets: number | null;
  cartons: number | null;
  declaredValue: number | null;
  currency: string | null;
  grossWeight: number | null;
  appointmentBooked: boolean | null;
  /** Seller-picked carrier (override). null = use the recommended one. */
  chosenCarrier?: CarrierId | null;
  items: Item[];
  quarantined?: Quarantine[];
  duplicateOf?: boolean;
}

export interface CarrierRow {
  carrier: string;
  service: string;
  originCountry: string;
  destinationCountry: string;
  pricePerPallet: number;
  currency: string;
  transitDays: number;
  onTimePct: number;
  maxKgPerPallet: number;
}

export interface Weights {
  cost: number;
  transit: number;
  reliability: number;
}

export interface GateNote {
  code: GateCode;
  message: string;
  rowId?: string;
  field?: string;
}

export interface RuleResult {
  id: RuleId;
  severity: Severity;
  text: string;
  status: RuleStatus;
  /** Plain-English problem (templated, deterministic). */
  message: string;
  /** Numbers involved, already formatted for display. */
  numbers?: string[];
  /** Items involved (rowIds). */
  itemRowIds?: string[];
  /** Rule-specific state (e.g. R-05 state, R-06 kind). */
  state?: string;
  caveat?: string;
}

export type MutableField =
  | "booking.pallets"
  | "booking.cartons"
  | "booking.declared_value"
  | "booking.gross_weight"
  | "item.hs_code"
  | "item.quantity"
  | "item.cartons";

export interface Change {
  field: MutableField;
  rowId?: string;
  sku?: string;
  from: number | string | null;
  to: number | string;
}

export interface Repair {
  rules: RuleId[];
  stage: 1 | 2 | 3 | null;
  confidence: Confidence;
  /** The single proposed change set (empty when no value can be proposed). */
  changes: Change[];
  /** Ambiguous: every tied option. */
  options?: Change[][];
  applyEnabled: boolean;
  arithmetic: string[];
  message: string;
  /** R-07 weight floor, kg. */
  floor?: number;
  /** Stage 3: the rule this separate report is about. */
  itemRowId?: string;
}

export interface Dates {
  ready: string | null;
  collection: string | null;
  eta: string | null;
}

export interface CarrierOption {
  id: CarrierId;
  name: string;
  service: string;
  transitDays: number;
  onTimePct: number;
  maxKgPerPallet: number;
  pricePerPallet: number;
  totalCost: number | null;
  feasible: boolean;
  minPallets: number | null;
  eta: string | null;
}

export interface BalancedRow {
  id: CarrierId;
  costN: number;
  transitN: number;
  reliabilityN: number;
  score: number;
}

export interface CarrierResult {
  lane: string | null;
  kgPerPallet: number | null;
  options: CarrierOption[];
  feasible: CarrierId[];
  recommended: CarrierId | null;
  chosen: CarrierId | null;
  override: CarrierId | null;
  r05: R05State;
  priority: Priority;
  priorityAssumed: boolean;
  weights: Weights;
  balanced: BalancedRow[];
  runnerUp: CarrierId | null;
  dates: Dates;
  minPallets: Partial<Record<CarrierId, number>>;
}

export interface BookingResult {
  booking: Booking;
  gate: GateNote[];
  rules: RuleResult[];
  verdict: Verdict;
  carrier: CarrierResult;
  repairs: Repair[];
  fyi: string[];
  hazards: Record<string, { kind: HazardKind; matched: string | null; source: "keyword" | "list" | "model" | null }>;
}

export interface Env {
  /** Europe/London date, ISO YYYY-MM-DD. Injected; never read from the clock inside the engine. */
  today: string;
  weights?: Weights;
  /** Model-classified implied hazards by item rowId (may only ADD "implied"). */
  hazardHints?: Record<string, HazardKind>;
  /** Chat: booking fields the app computes from the items (never "blamed" by a repair; recomputed with it). */
  derived?: { declaredValue: boolean; cartons: boolean };
  /** Chat: values the seller explicitly confirmed, as "item.quantity@<rowId>" (repairs touching them are never High). */
  confirmed?: string[];
  /** Chat: optional fields not asked yet, as "hsCode@<rowId>" / "countryOfOrigin@<rowId>" (their rules are "not checked"). */
  pendingFields?: string[];
  /** Chat: details still being collected; while non-empty the verdict is INCOMPLETE. */
  capture?: string[];
}
