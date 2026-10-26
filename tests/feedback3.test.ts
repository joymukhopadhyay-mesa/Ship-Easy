// Regressions for teammate test round 3 (26-10-2026).
import { describe, expect, it } from "vitest";
import { chatTurn, extractContext, newChat, type ChatState } from "@/lib/chat";
import { wordsToNumber, extractLocal } from "@/lib/localExtract";
import { sanitisePatch, type Patch } from "@/lib/patch";
import { plural } from "@/lib/format";

const env = { today: "2026-10-26" };
const say = (st: ChatState, m: string) => chatTurn(st, extractLocal(m, extractContext(st, env.today)), m, env, "26-10-2026 10:00");
const TWO_ITEMS = "Ship 300 mugs and 100 bowls from London to a shop in Paris, ready 05-11-2026";

describe("#11 Fastest never pays more for the same delivery day", () => {
  it("Thursday ready: B and C both deliver Mon 9 Nov -> cheaper B, reason says why", () => {
    const t = say(newChat(env), "Ship 300 mugs from London to a shop in Paris, ready 05-11-2026, £5 each, 10 per carton, 0.5 kg each, HS 691200, made in the UK, 200 kg on 1 pallet, fastest");
    const c = t.state.session.result.carrier;
    expect(c.options.find((o) => o.id === "B")!.eta).toBe(c.options.find((o) => o.id === "C")!.eta);
    expect(c.chosen).toBe("B");
    expect(t.reply).toMatch(/earliest delivery, Mon 9 Nov 2026/);
    expect(t.reply).toMatch(/Carrier C is quicker on the road but arrives the same day/);
  });
  it("Demo 2 (Monday ready) still upgrades to C: +GBP 700, 1 day faster", () => {
    const t1 = say(newChat(env), "Ship 1,200 wooden chopping boards from Leeds to a warehouse in Frankfurt, ready 02-11-2026. £9 each, 10 per carton, 0.95 kg each, HS 441990, made in Vietnam. Total weight 1,260 kg on 3 pallets. Fastest please, appointment is booked.");
    const t2 = say(t1.state, "add another pallet");
    expect(t2.state.session.log.at(-1)!.lines.at(-1)).toBe("Carrier B (3d, GBP 660) -> C (2d, GBP 1,360) +GBP 700, 1 day faster");
  });
});

describe("#12 the gross weight is re-asked when products are added or removed", () => {
  const full = (() => {
    let t = say(newChat(env), TWO_ITEMS);
    t = say(t.state, "mugs £5 each, 10 per carton, 0.5 kg each, HS 691200, made in the UK");
    t = say(t.state, "bowls £7 each, 10 per carton, 0.3 kg each, HS 691200, made in the UK");
    t = say(t.state, "400 kg on 1 pallet, cheapest");
    return t;
  })();
  it("setup: a complete booking at 400 kg", () => {
    expect(full.state.session.booking.grossWeight).toBe(400);
    expect(full.state.session.booking.items.length).toBe(2);
  });
  it("removing the bowls clears the 400 kg and asks again (goods alone now 150 kg)", () => {
    const t = say(full.state, "remove the bowls");
    expect(t.state.session.booking.items.map((i) => i.description)).toEqual(["mugs"]);
    expect(t.state.session.booking.grossWeight).toBeNull();
    expect(t.reply).toMatch(/old gross weight \(400 kg\) no longer fits/);
    expect(t.reply).toMatch(/goods alone come to about 150 kg/);
    expect(t.state.session.result.verdict).toBe("INCOMPLETE");
  });
  it("stating the new weight in the same message keeps it", () => {
    const t = say(full.state, "remove the bowls, it's now 180 kg");
    expect(t.state.session.booking.grossWeight).toBe(180);
  });
});

describe("#13 Local-only understands number words, removals and refuses non-GBP prices", () => {
  it("number words", () => {
    expect([wordsToNumber("five hundred"), wordsToNumber("a dozen"), wordsToNumber("two thousand five hundred"), wordsToNumber("twenty-four"), wordsToNumber("half a dozen")]).toEqual([500, 12, 2500, 24, 6]);
    const t = say(newChat(env), "send five hundred ceramic mugs to Berlin on two pallets, twelve per carton");
    expect(t.state.session.booking.items.map((i) => [i.description, i.quantity, i.unitsPerCarton])).toEqual([["ceramic mugs", 500, 12]]);
    expect(t.state.session.booking.pallets).toBe(2);
  });
  it("number words never eat real words ('tennis', 'one more pallet', 'a quote')", () => {
    expect(say(newChat(env), "200 tennis balls to Paris").state.session.booking.items[0].description).toBe("tennis balls");
    expect(say(newChat(env), "Can I get a quote for 3 pallets to Frankfurt?").state.session.booking.items).toEqual([]);
  });
  it("remove a product", () => {
    const t1 = say(newChat(env), TWO_ITEMS);
    const t2 = say(t1.state, "remove the bowls");
    expect(t2.state.session.booking.items.map((i) => i.description)).toEqual(["mugs"]);
    expect(t2.reply).toMatch(/Removed bowls/);
    expect(say(t1.state, "we're no longer sending the mugs").state.session.booking.items.map((i) => i.description)).toEqual(["bowls"]);
  });
  it("USD / EUR prices are not used, and the seller is told", () => {
    for (const m of ["300 mugs to Paris at $5 each", "300 mugs to Paris, 5 dollars each", "300 mugs to Paris at €4"]) {
      const t = say(newChat(env), m);
      expect(t.state.session.booking.items[0].unitPrice, m).toBeNull();
      expect(t.reply, m).toMatch(/Prices must be in pounds \(GBP\)/);
    }
  });
  it("a model patch converting $5 to a price is still refused", () => {
    const st = say(newChat(env), "300 mugs to Paris").state;
    const p: Patch = { set: {}, items: [{ op: "update", sku: st.session.booking.items[0].sku, fields: { unitPrice: { value: 5, source: "$5 each" } } }], questions_answered: [], choice: null, declined: [] };
    const t = chatTurn(st, p, "they're $5 each", env, "x");
    expect(t.state.session.booking.items[0].unitPrice).toBeNull();
  });
  it("a removal needs the seller's words (no silent removals)", () => {
    const { patch } = sanitisePatch({ set: {}, items: [{ op: "remove", sku: "MUG-01", fields: {} }], questions_answered: [], choice: null, declined: [] }, "hello");
    expect(patch.items).toEqual([]);
  });
});

describe("small: up to 3 grouped questions per turn; correct plurals", () => {
  it("fills to 3 questions across groups when one group is short", () => {
    let t = say(newChat(env), "Need to send 600 cast iron skillets to Hamburg");
    t = say(t.state, "From Birmingham, ready 02-11-2026, it's going to their warehouse");
    t = say(t.state, "£18 each, 6 per carton, 2.3 kg each");
    expect(t.state.expecting.map((s) => s.field)).toEqual(["hsCode", "countryOfOrigin", "grossWeight"]);
    expect(t.reply).toMatch(/\(1\).*\(2\).*\(3\)/);
  });
  it("plural helper", () => {
    expect([plural(1, "check"), plural(2, "check"), plural(1, "pallet"), plural(1080, "unit")]).toEqual(["1 check", "2 checks", "1 pallet", "1,080 units"]);
  });
});
