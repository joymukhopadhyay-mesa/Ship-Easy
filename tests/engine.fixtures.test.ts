import { describe, expect, it } from "vitest";
import { diffLines } from "@/lib/changelog";
import { round2 } from "@/lib/format";
import { applyChanges, sellerActions, STAGE3_MESSAGE } from "@/lib/repair";
import { buildContext } from "@/lib/context";
import { validateBooking } from "@/lib/validate";
import type { Booking, BookingResult } from "@/lib/types";
import { expected, loadFixture, TODAY } from "./helpers/loadFixture";

const env = { today: TODAY };

function snapshot(res: BookingResult) {
  const c = res.carrier;
  const chosen = c.options.find((o) => o.id === c.chosen);
  return {
    verdict: res.verdict,
    rules: Object.fromEntries(res.rules.map((r) => [r.id, r.status])),
    gate: res.gate.map((g) => g.code),
    kgPerPallet: c.kgPerPallet === null ? null : round2(c.kgPerPallet),
    r05: c.r05,
    feasible: c.feasible,
    recommended: c.recommended,
    chosen: c.chosen,
    totalCost: chosen?.totalCost ?? null,
    dates: c.dates,
    minPallets: c.minPallets,
    etaAll: Object.fromEntries(c.options.map((o) => [o.id, o.eta])),
    balancedScores: Object.fromEntries(c.balanced.map((b) => [b.id, round2(b.score)])),
  };
}

const KEYS = ["verdict", "rules", "gate", "kgPerPallet", "r05", "feasible", "recommended", "chosen", "totalCost", "dates", "minPallets", "etaAll", "balancedScores"] as const;

describe("every fixture matches fixtures/expected.json", () => {
  for (const fx of expected.fixtures) {
    describe(`${fx.id} ${fx.file}`, () => {
      const { bookings, orphans } = loadFixture(fx.file);

      it("orphans (D-03)", () => {
        expect(orphans).toEqual(fx.unmatched);
      });

      for (const eb of fx.bookings) {
        const b = bookings.find((x: Booking) => x.bookingId === eb.bookingId)!;
        const res = validateBooking(b, env);
        const snap = snapshot(res);

        it("verdict, rules, gate, carrier, dates", () => {
          for (const k of KEYS) if (k in eb) expect(snap[k], k).toEqual(eb[k]);
        });

        if (eb.hsCaveat) it("R-01 5-digit caveat", () => expect(res.rules.find((r) => r.id === "R-01")!.caveat).toMatch(/lost leading zero/));

        if (eb.hazard) {
          it(`R-06 ${eb.hazard.kind} stays Red`, () => {
            const r06 = res.rules.find((r) => r.id === "R-06")!;
            expect(r06.severity).toBe("Red");
            expect(r06.state).toBe(eb.hazard.kind);
            const item = b.items.find((i) => i.sku === eb.hazard.sku)!;
            expect(res.hazards[item.rowId].kind).toBe(eb.hazard.kind);
            if (eb.hazard.kind === "implied") expect(r06.message).toMatch(/Blocked pending seller confirmation/);
          });
        }

        if (eb.repairs) {
          it("repairs", () => {
            for (const er of eb.repairs) {
              if (er.stage === 3) {
                const s3 = res.repairs.filter((r) => r.stage === 3);
                expect(s3.length).toBeGreaterThan(1);
                expect([...new Set(s3.flatMap((r) => r.rules))].sort()).toEqual(er.rules);
                for (const r of s3) {
                  expect(r.confidence).toBe("Possible");
                  expect(r.applyEnabled).toBe(false);
                  expect(r.message.startsWith(STAGE3_MESSAGE)).toBe(true);
                }
                expect(res.repairs.some((r) => r.applyEnabled)).toBe(false);
                continue;
              }
              const got = res.repairs.find((r) => JSON.stringify(r.rules) === JSON.stringify(er.rules));
              expect(got, `repair for ${er.rules}`).toBeDefined();
              expect(got!.stage).toBe(er.stage);
              expect(got!.confidence).toBe(er.confidence);
              expect(got!.applyEnabled).toBe(er.confidence === "High");
              const strip = (cs: { field: string; sku?: string; from: unknown; to: unknown }[]) => cs.map(({ field, sku, from, to }) => ({ field, ...(sku ? { sku } : {}), from, to }));
              if (er.options) expect(got!.options!.map(strip)).toEqual(er.options);
              else expect(strip(got!.changes)).toEqual(er.changes);
              if (er.floor) expect(got!.floor).toBe(er.floor);
            }
            expect(res.repairs.length).toBe(eb.repairs[0].stage === 3 ? res.repairs.length : eb.repairs.length);
          });
        }

        if (eb.overrideFixes) {
          it("seller override offers switch-to and add-pallets", () => {
            const acts = sellerActions(b, res.rules, buildContext(b, env));
            const sw = acts.find((a) => a.id === "switch")!;
            expect(sw.label).toContain(`Carrier ${eb.overrideFixes.switchTo}`);
            expect(sw.label).toContain(`£${eb.overrideFixes.switchCost}`);
            const add = acts.find((a) => a.id === "add-pallets")!;
            expect(Number(add.changes![0].to) - b.pallets!).toBe(eb.overrideFixes.addPallets);
          });
        }

        for (const v of fx.variants ?? []) {
          it(`variant ${JSON.stringify(v.change)}`, () => {
            const b2 = applyChanges(b, [{ field: "booking.pallets", from: b.pallets, to: v.change.pallets }]);
            const res2 = validateBooking(b2, env);
            const s2 = snapshot(res2);
            for (const k of KEYS) if (k in v.expect) expect(s2[k], k).toEqual(v.expect[k]);
            if (v.expect.changeLog) expect(diffLines(res, res2, [{ label: "Pallets", from: b.pallets, to: v.change.pallets }])).toEqual(v.expect.changeLog);
          });
        }
      }
    });
  }
});
