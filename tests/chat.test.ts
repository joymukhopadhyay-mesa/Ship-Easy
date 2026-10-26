import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { chatTurn, extractContext, newChat, nonDivisibleOptions, type ChatState } from "@/lib/chat";
import { extractLocal, findDate } from "@/lib/localExtract";
import { sanitisePatch, type Patch } from "@/lib/patch";
import { validateBooking } from "@/lib/validate";
import type { Item } from "@/lib/types";

const TODAY = "2026-10-25";
const env = { today: TODAY };
const STAMP = "25-10-2026 12:00";
const script = (f: string) => JSON.parse(fs.readFileSync(path.resolve(__dirname, "../fixtures/chat", f), "utf8"));
const say = (st: ChatState, msg: string) => chatTurn(st, extractLocal(msg, extractContext(st, TODAY)), msg, env, STAMP);
const rule = (st: ChatState, id: string) => st.session.result.rules.find((r) => r.id === id)!;

describe("chat script: non-divisible quantity", () => {
  const s = script("non-divisible.json");
  const t1 = say(newChat(env), s.turns[0].user);
  it("asks BEFORE computing cartons, with the exact options", () => {
    const it0 = t1.state.session.booking.items[0];
    expect(it0.cartons).toBeNull();
    expect(t1.state.pending).not.toBeNull();
    const nd = t1.state.pending!;
    expect([nd.quantity, nd.unitsPerCarton, nd.remainder]).toEqual([1000, 12, 4]);
    expect(nd.options.map((o) => ({ key: o.key, lines: o.lines }))).toEqual(s.turns[0].expect.nonDivisible.options);
    expect(t1.reply).toContain("1,000 doesn't divide into 12s; the last carton would hold 4 units");
    expect(t1.reply).toContain("(a) 996 units in 83 cartons");
    expect(t1.reply).toContain("(b) 1,008 units in 84 cartons");
    expect(t1.reply).toContain("(c) keep 1,000 as 83 cartons of 12 plus 1 carton of 4, booked as a second line for the same SKU");
  });
  it("invariant: every option passes R-03", () => {
    for (const o of t1.state.pending!.options) {
      const items: Item[] = o.lines.map((l, k) => ({ ...t1.state.session.booking.items[0], rowId: `x${k}`, quantity: l.quantity, unitsPerCarton: l.unitsPerCarton, cartons: l.cartons }));
      const r = validateBooking({ ...t1.state.session.booking, items }, env).rules.find((x) => x.id === "R-03")!;
      expect(r.status, o.key).toBe("pass");
    }
  });
  it("answer (b) -> 1,008 units in 84 cartons, R-03 passes", () => {
    const t2 = say(t1.state, s.turns[1].user);
    const it0 = t2.state.session.booking.items[0];
    expect([it0.quantity, it0.cartons, it0.unitsPerCarton]).toEqual([1008, 84, 12]);
    expect(rule(t2.state, "R-03").status).toBe("pass");
    expect(t2.state.pending).toBeNull();
  });
  it("answer (c) -> two lines for the same SKU, both pass R-03", () => {
    const t2 = say(t1.state, "c");
    const its = t2.state.session.booking.items;
    expect(its.map((i) => [i.sku, i.quantity, i.unitsPerCarton, i.cartons])).toEqual([[its[0].sku, 996, 12, 83], [its[0].sku, 4, 4, 1]]);
    expect(rule(t2.state, "R-03").status).toBe("pass");
    expect(t2.state.session.booking.cartons).toBe(84);
  });
  it("nonDivisibleOptions never offers a zero-unit option", () => {
    const nd = nonDivisibleOptions({ rowId: "x", sku: "S", description: "", hsCode: null, quantity: 5, unitPrice: 1, unitsPerCarton: 12, cartons: null, unitWeight: 1, countryOfOrigin: null })!;
    expect(nd.options.map((o) => o.key)).toEqual(["b"]);
  });
});

describe("chat script: implied hazard", () => {
  const s = script("implied-hazard.json");
  const t = say(newChat(env), s.turns[0].user);
  it("infers country, type, currency, origin; R-06 Red pending confirmation, never Amber", () => {
    const b = t.state.session.booking;
    expect({ destinationCountry: b.destinationCountry, destinationType: b.destinationType, currency: b.currency, originCountry: b.originCountry }).toEqual(s.turns[0].expect.inferred);
    const r = rule(t.state, "R-06");
    expect([r.status, r.severity, r.state]).toEqual(["fail", "Red", "implied"]);
    expect(r.message).toContain("Blocked pending seller confirmation");
    expect(t.reply).toMatch(/Heads-up/);
  });
});

describe("chat script: untouched fields after a patch", () => {
  const s = script("untouched-field.json");
  const t1 = say(newChat(env), s.turns[0].user);
  it("one rich message completes the booking", () => {
    const b = t1.state.session.booking;
    expect(t1.state.baselined).toBe(true);
    for (const [k, v] of Object.entries(s.turns[0].expect.booking)) expect((b as unknown as Record<string, unknown>)[k], k).toEqual(v);
    expect(t1.state.session.result.carrier.chosen).toBe("B");
    expect(t1.reply).toContain("That's everything I need");
  });
  it('"add another pallet" changes ONLY pallets; change log matches Demo 2 exactly', () => {
    const t2 = say(t1.state, s.turns[1].user);
    expect(Object.keys(t2.applied.set)).toEqual(["pallets"]);
    expect(t2.applied.items).toEqual([]);
    const a = t1.state.session.booking, b = t2.state.session.booking;
    expect(b.pallets).toBe(4);
    expect({ ...b, pallets: a.pallets }).toEqual(a);
    expect(t2.state.session.log.at(-1)!.lines).toEqual(s.turns[1].expect.changeLog);
    expect(t2.state.session.result.carrier.chosen).toBe("C");
  });
});

describe("Part 1 style: casual sentence with gaps, grouped questions (max 3)", () => {
  it("asks only what's missing, in groups, and ends with a complete booking", () => {
    let t = say(newChat(env), "Need to send 600 cast iron skillets to Hamburg");
    expect(t.state.expecting.map((s) => s.field)).toEqual(["originCity", "readyDate", "destinationType"]);
    t = say(t.state, "From Birmingham, ready 02-11-2026, it's going to their warehouse");
    expect(t.state.expecting.map((s) => s.field)).toEqual(["unitPrice", "unitsPerCarton", "unitWeight"]);
    t = say(t.state, "£18 each, 6 per carton, 2.3 kg each");
    expect(t.state.session.booking.items[0].cartons).toBe(100);
    expect(t.reply).toContain("600 ÷ 6 = 100 cartons");
    expect(t.state.expecting.map((s) => s.field)).toEqual(["hsCode", "countryOfOrigin", "grossWeight"]);
    t = say(t.state, "HS 732393, made in China");
    expect(t.state.expecting.map((s) => s.field)).toEqual(["grossWeight", "pallets", "priority"]);
    expect(t.reply).toContain("1,380 kg");
    t = say(t.state, "1600 kg on 2 pallets");
    expect(t.state.expecting.map((s) => s.field)).toEqual(["priority", "appointmentBooked"]);
    t = say(t.state, "balanced, and yes the appointment is booked");
    const st = t.state;
    expect(st.baselined).toBe(true);
    expect(st.session.result.verdict).toBe("BLOCKED");
    expect(st.session.result.carrier.r05).toBe("no_carrier_fits");
    t = say(st, "ok add another pallet");
    expect(t.state.session.log.at(-1)!.lines).toEqual(["Pallets 2 -> 3", "Weight/pallet 800 -> 533 kg", "R-05 Red (no carrier fits) -> Pass", "Carrier none -> B (3d, GBP 660)"]);
    expect(t.state.session.result.verdict).toBe("CLEAR TO SHIP");
  });

  it("\"don't know\" for an HS code is accepted (then R-01 flags it), not re-asked", () => {
    let t = say(newChat(env), "200 tote bags from London to a shop in Lyon ready tomorrow, £8 each, 10 per carton, 0.2kg each");
    expect(t.state.expecting.map((s) => s.field)).toEqual(["hsCode", "countryOfOrigin", "grossWeight"]);
    t = say(t.state, "don't know");
    expect(t.state.expecting.map((s) => s.field)).toEqual(["grossWeight", "pallets", "priority"]);
  });
});

describe("patch guard-rails", () => {
  it("source check: a value whose phrase is not in the latest message is rejected", () => {
    const p: Patch = { set: { pallets: { value: 9, source: "nine pallets" }, priority: { value: "Fastest", source: "fastest" } }, items: [], questions_answered: [], choice: null, declined: [] };
    const { patch, rejected } = sanitisePatch(p, "make it the fastest option");
    expect(Object.keys(patch.set)).toEqual(["priority"]);
    expect(rejected).toEqual([{ field: "pallets", value: 9, source: "nine pallets", reason: "not in latest message" }]);
  });
  it("allow-list: inferred and computed fields can't be set by an extractor", () => {
    const p: Patch = { set: { declaredValue: { value: 1, source: "1" }, destinationCountry: { value: "France", source: "1" }, currency: { value: "EUR", source: "1" } }, items: [{ op: "update", sku: "X", fields: { unitPrice: { value: 1, source: "1" }, sku: { value: "Y", source: "1" } } }], questions_answered: [], choice: null, declined: [] };
    const { patch, rejected } = sanitisePatch(p, "1");
    expect(patch.set).toEqual({});
    expect(rejected.map((r) => r.field).sort()).toEqual(["currency", "declaredValue", "destinationCountry", "item.sku"]);
    expect(patch.items[0].fields).toEqual({ unitPrice: { value: 1, source: "1" } });
  });
  it("a model patch can't touch a field the seller didn't mention (merge keeps everything else)", () => {
    const t1 = say(newChat(env), script("untouched-field.json").turns[0].user);
    const evil: Patch = { set: { pallets: { value: 4, source: "another pallet" }, grossWeight: { value: 99, source: "99 kg" } }, items: [{ op: "update", sku: t1.state.session.booking.items[0].sku, fields: { quantity: { value: 1, source: "1 unit" } } }], questions_answered: [], choice: null, declined: [] };
    const t2 = chatTurn(t1.state, evil, "add another pallet please", env, STAMP);
    expect(t2.state.session.booking.grossWeight).toBe(1260);
    expect(t2.state.session.booking.items[0].quantity).toBe(1200);
    expect(t2.state.session.booking.pallets).toBe(4);
    expect(t2.rejected.length).toBe(2);
  });
});

describe("relative dates resolve against injected today and are confirmed", () => {
  it("weekdays, tomorrow, DD-MM-YYYY, '5 Nov'", () => {
    expect(findDate("ready next Tuesday", TODAY)!.iso).toBe("2026-10-27");
    expect(findDate("ready tomorrow", TODAY)!.iso).toBe("2026-10-26");
    expect(findDate("on 07-11-2026", TODAY)!.iso).toBe("2026-11-07");
    expect(findDate("5th Nov", TODAY)!.iso).toBe("2026-11-05");
    expect(findDate("ready 20 Oct", TODAY)!.iso).toBe("2027-10-20");
  });
  it("the bot confirms the absolute date", () => {
    const t = say(newChat(env), "sending mugs to Berlin next Tuesday");
    expect(t.reply).toContain(`I've read "next Tuesday" as Tue 27 Oct 2026`);
  });
});
