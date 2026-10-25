// Allowed values (template "Allowed values" sheet) and engine constants.
// Carrier data is NOT here: it lives only in data/carriers.json.
import type { DestinationType, Priority, Weights } from "./types";

export const ORIGIN_COUNTRY = "United Kingdom";
export const CURRENCY = "GBP";
export const TIMEZONE = "Europe/London";

export const ORIGIN_CITIES = ["London", "Manchester", "Birmingham", "Leeds"] as const;

export const DESTINATION_CITIES: Record<string, string> = {
  Berlin: "Germany",
  Frankfurt: "Germany",
  Hamburg: "Germany",
  Paris: "France",
  Lyon: "France",
  Amsterdam: "Netherlands",
  Rotterdam: "Netherlands",
};

export const DESTINATION_COUNTRIES = ["Germany", "France", "Netherlands"] as const;

export const ITEM_ORIGIN_COUNTRIES = ["United Kingdom", "China", "India", "Vietnam", "Turkey", "Germany"] as const;

export const COUNTRY_ALIASES: Record<string, string> = {
  uk: "United Kingdom",
  "u.k.": "United Kingdom",
  "great britain": "United Kingdom",
  britain: "United Kingdom",
  england: "United Kingdom",
  "united kingdom": "United Kingdom",
  china: "China",
  prc: "China",
  india: "India",
  vietnam: "Vietnam",
  "viet nam": "Vietnam",
  turkey: "Turkey",
  "türkiye": "Turkey",
  turkiye: "Turkey",
  germany: "Germany",
  deutschland: "Germany",
  france: "France",
  netherlands: "Netherlands",
  "the netherlands": "Netherlands",
  holland: "Netherlands",
};

export const PRIORITIES: Priority[] = ["Cheapest", "Fastest", "Most reliable", "Balanced"];
export const DESTINATION_TYPES: DestinationType[] = ["Warehouse", "Business address"];

/** R-02 tolerance, measured against the computed sum (stated assumption). */
export const DECLARED_VALUE_TOLERANCE = 0.01;

/** Balanced default weights (cost 40 / transit 30 / reliability 30). */
export const DEFAULT_WEIGHTS: Weights = { cost: 0.4, transit: 0.3, reliability: 0.3 };

/** Stage 2 bounded pair search cap. */
export const PAIR_SEARCH_CAP = 200;

export const HS_MIN_DIGITS = 6;

export const TRADE_TARIFF_URL = "gov.uk/trade-tariff";

export function normaliseCountry(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (!t) return null;
  return COUNTRY_ALIASES[t.toLowerCase()] ?? t;
}

export function cityCountry(city: string | null | undefined): string | null {
  if (!city) return null;
  const key = Object.keys(DESTINATION_CITIES).find((c) => c.toLowerCase() === String(city).trim().toLowerCase());
  return key ? DESTINATION_CITIES[key] : null;
}

export function canonicalCity(city: string | null | undefined, list: readonly string[]): string | null {
  if (!city) return null;
  return list.find((c) => c.toLowerCase() === String(city).trim().toLowerCase()) ?? null;
}
