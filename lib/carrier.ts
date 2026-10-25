// Carrier engine: lane filter, feasibility (cap inclusive), four ranking modes,
// Balanced formula, chosen carrier, the three R-05 states, min pallets, dates.
// Rate card comes ONLY from data/carriers.json.
import carriersData from "@/data/carriers.json";
import { cityCountry, DEFAULT_WEIGHTS, normaliseCountry } from "./config";
import { collectionDate, etaDate } from "./dates";
import type { BalancedRow, Booking, CarrierId, CarrierOption, CarrierResult, CarrierRow, Priority, Weights } from "./types";

export const CARRIERS: CarrierRow[] = carriersData.carriers;

export function carrierId(name: string): CarrierId | null {
  const m = /^\s*(?:carrier\s+)?([abc])\s*$/i.exec(name ?? "");
  return m ? (m[1].toUpperCase() as CarrierId) : null;
}

export function laneOf(booking: Pick<Booking, "destinationCountry" | "destinationCity">): string | null {
  const c = normaliseCountry(booking.destinationCountry);
  if (c && CARRIERS.some((r) => r.destinationCountry === c)) return c;
  return cityCountry(booking.destinationCity);
}

export function laneRows(lane: string): CarrierRow[] {
  return CARRIERS.filter((r) => r.destinationCountry === lane);
}

const isPos = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

export function normaliseWeights(w: Weights): Weights {
  const s = w.cost + w.transit + w.reliability;
  if (!(s > 0)) return { ...DEFAULT_WEIGHTS };
  return { cost: w.cost / s, transit: w.transit / s, reliability: w.reliability / s };
}

const minMax = (vals: number[], v: number) => {
  const mn = Math.min(...vals);
  const mx = Math.max(...vals);
  return mx === mn ? 0 : (v - mn) / (mx - mn);
};

/** Min-max normalise over the FEASIBLE set (0 = best); if max == min the term is 0. */
export function balancedScores(opts: CarrierOption[], weights: Weights): BalancedRow[] {
  const w = normaliseWeights(weights);
  const costs = opts.map((o) => o.totalCost ?? 0);
  const transits = opts.map((o) => o.transitDays);
  const unrel = opts.map((o) => -o.onTimePct);
  return opts.map((o) => {
    const costN = minMax(costs, o.totalCost ?? 0);
    const transitN = minMax(transits, o.transitDays);
    const reliabilityN = minMax(unrel, -o.onTimePct);
    return { id: o.id, costN, transitN, reliabilityN, score: w.cost * costN + w.transit * transitN + w.reliability * reliabilityN };
  });
}

type Key = (o: CarrierOption) => number;
const sortBy = (opts: CarrierOption[], keys: Key[]) =>
  [...opts].sort((a, b) => {
    for (const k of keys) {
      const d = k(a) - k(b);
      if (Math.abs(d) > 1e-12) return d;
    }
    return a.id.localeCompare(b.id);
  });

const cost: Key = (o) => o.totalCost ?? Infinity;
const transit: Key = (o) => o.transitDays;
const unreliability: Key = (o) => -o.onTimePct;

/** Ranks feasible options for a priority; first = recommended. */
export function rank(feasible: CarrierOption[], priority: Priority, weights: Weights): CarrierOption[] {
  switch (priority) {
    case "Cheapest":
      return sortBy(feasible, [cost, transit, unreliability]);
    case "Fastest":
      return sortBy(feasible, [transit, unreliability, cost]);
    case "Most reliable":
      return sortBy(feasible, [unreliability, transit, cost]);
    case "Balanced": {
      const scores = Object.fromEntries(balancedScores(feasible, weights).map((r) => [r.id, r.score]));
      return sortBy(feasible, [(o) => scores[o.id], cost, transit]);
    }
  }
}

export function evaluateCarriers(booking: Booking, weights: Weights = DEFAULT_WEIGHTS): CarrierResult {
  const lane = laneOf(booking);
  const priority: Priority = booking.priority ?? "Balanced";
  const pallets = booking.pallets;
  const gross = booking.grossWeight;
  const canCompute = lane !== null && isPos(pallets) && typeof gross === "number" && Number.isFinite(gross) && gross >= 0;
  const ready = booking.readyDate;
  const collection = ready ? collectionDate(ready) : null;

  const options: CarrierOption[] = (lane ? laneRows(lane) : []).map((r) => {
    const id = carrierId(r.carrier)!;
    const feasible = canCompute ? gross! <= r.maxKgPerPallet * pallets! : false;
    return {
      id,
      name: r.carrier,
      service: r.service,
      transitDays: r.transitDays,
      onTimePct: r.onTimePct,
      maxKgPerPallet: r.maxKgPerPallet,
      pricePerPallet: r.pricePerPallet,
      totalCost: isPos(pallets) ? r.pricePerPallet * pallets : null,
      feasible,
      minPallets: typeof gross === "number" && gross > 0 ? Math.ceil(gross / r.maxKgPerPallet) : null,
      eta: collection ? etaDate(collection, r.transitDays) : null,
    };
  });

  const feasibleOpts = options.filter((o) => o.feasible);
  const ranked = rank(feasibleOpts, priority, weights);
  const recommended = ranked[0]?.id ?? null;
  const runnerUp = ranked[1]?.id ?? null;
  const override = booking.chosenCarrier && options.some((o) => o.id === booking.chosenCarrier) ? booking.chosenCarrier : null;
  const chosen = canCompute ? override ?? recommended : null;

  let r05: CarrierResult["r05"];
  if (!canCompute) r05 = "cannot_compute";
  else if (feasibleOpts.length === 0) r05 = "no_carrier_fits";
  else if (override && !options.find((o) => o.id === override)!.feasible) r05 = "seller_override";
  else r05 = "pass";

  const chosenOpt = options.find((o) => o.id === chosen) ?? null;
  return {
    lane,
    kgPerPallet: canCompute ? gross! / pallets! : null,
    options,
    feasible: feasibleOpts.map((o) => o.id),
    recommended,
    chosen,
    override,
    r05,
    priority,
    priorityAssumed: booking.priority == null,
    weights: normaliseWeights(weights),
    balanced: balancedScores(feasibleOpts, weights),
    runnerUp,
    dates: { ready, collection, eta: chosenOpt?.eta ?? null },
    minPallets: Object.fromEntries(options.filter((o) => o.minPallets !== null).map((o) => [o.id, o.minPallets])),
  };
}
