// Regressions for the teammate test round (26-10-2026).
import { describe, expect, it } from "vitest";
import { chatTurn, extractContext, newChat, type ChatState } from "@/lib/chat";
import { confirmation, nextSteps } from "@/lib/explain";
import { extractLocal } from "@/lib/localExtract";
import type { Env } from "@/lib/types";

const env: Env = { today: "2026-10-26" };
const say = (st: ChatState, m: string, e: Env = env) => chatTurn(st, extractLocal(m, extractContext(st, e.today)), m, e, "26-10-2026 10:00");
const MUGS = "I'm sending 1,000 ceramic mugs from London to a warehouse in Berlin, 12 per carton, £5 each";

describe("#3 the chat acknowledges the seller's own numbers instead of looping", () => {
  const t1 = say(newChat(env), MUGS);
  const t2 = say(t1.state, "it really is 1,000 units in 90 cartons");
  it("keeps 1,000 in 90 cartons, no bogus item, no repeated (a)/(b)/(c)", () => {
    expect(t2.state.session.booking.items.map((i) => [i.sku, i.quantity, i.cartons])).toEqual([["MUG-01", 1000, 90]]);
    expect(t2.state.pending).toBeNull();
    expect(t2.reply).toContain("Keeping 1,000 units in 90 cartons as you said");
    expect(t2.reply).toContain("breaks R-03");
    expect(t2.reply).not.toContain("(a) 996 units");
    expect(t2.state.session.result.rules.find((r) => r.id === "R-03")!.status).toBe("fail");
  });
  it("an unhelpful answer gets a shorter follow-up, not the identical question", () => {
    const t = say(t1.state, "hmm not sure");
    expect(t.state.pending).not.toBeNull();
    expect(t.reply).toContain("I still need to know how the 1,000");
    expect(t.reply).not.toBe(t1.reply);
  });
});

describe("#4 repairs never blame an app-computed value or override a confirmed one", () => {
  const t2 = say(say(newChat(env), MUGS).state, "it really is 1,000 units in 90 cartons");
  const reps = t2.state.session.result.repairs.filter((r) => r.rules.includes("R-03"));
  it("no change to the computed declared value; confirmed quantity is never High or auto-applied", () => {
    expect(reps.length).toBe(1);
    for (const r of [reps[0], ...(reps[0].options ?? []).map((cs) => ({ changes: cs }))]) {
      for (const c of r.changes) expect(c.field).not.toBe("booking.declared_value");
    }
    expect(reps[0].confidence).not.toBe("High");
    expect(reps[0].applyEnabled).toBe(false);
    expect(reps[0].message).toContain("You confirmed");
  });
  it("R-02 never fails in chat while the declared value is computed from the items", () => {
    expect(t2.state.session.result.rules.find((r) => r.id === "R-02")!.status).toBe("pass");
  });
});

describe("#5 INCOMPLETE (not BLOCKED) while the chat is still asking", () => {
  it("first message: HS code not asked yet -> R-01 not checked, verdict INCOMPLETE", () => {
    const t = say(newChat(env), MUGS);
    expect(t.state.session.result.verdict).toBe("INCOMPLETE");
    expect(t.state.session.result.rules.find((r) => r.id === "R-01")!.status).toBe("not_checked");
    expect(t.state.session.result.gate[0].message).toMatch(/Still collecting in chat/);
  });
  it("a declined HS code is then checked (R-01 Red) once the chat is complete", () => {
    let t = say(newChat(env), "200 tote bags from London to a shop in Lyon ready 05-11-2026, £8 each, 10 per carton, 0.2kg each");
    t = say(t.state, "don't know");
    t = say(t.state, "50 kg on 1 pallet");
    t = say(t.state, "cheapest");
    expect(t.state.session.capture).toBeNull();
    expect(t.state.session.result.rules.find((r) => r.id === "R-01")!.status).toBe("fail");
    expect(t.state.session.result.verdict).toBe("BLOCKED");
  });
});

describe("#7 the change log records changes during capture", () => {
  it("first message already logs what was filled and what flipped", () => {
    const t = say(newChat(env), MUGS);
    expect(t.state.session.log.length).toBe(1);
    expect(t.state.session.log[0].lines.join(" | ")).toMatch(/Destination blank -> Berlin/);
    const t2 = say(t.state, "it really is 1,000 units in 90 cartons");
    expect(t2.state.session.log.length).toBe(2);
    expect(t2.state.session.log[1].lines.join(" | ")).toMatch(/MUG-01 cartons blank -> 90/);
  });
});

describe("#8 confirmation and next steps never contradict the verdict", () => {
  it("unknown numbers are named, not shown as 0", () => {
    const c = confirmation(say(newChat(env), MUGS).state.session.result);
    expect(c).not.toMatch(/\b0 (cartons|pallets)\b/);
    expect(c).toContain("Still to confirm: cartons, pallets, gross weight");
  });
  it("a blocked booking is never told the carrier will collect", () => {
    let t = say(newChat(env), "Ship 600 cast iron skillets from Birmingham to our warehouse in Hamburg, ready 02-11-2026. £18 each, 6 per carton, 2.3 kg each, HS 732393, made in China. 1,700 kg on 3 pallets. Balanced please, delivery appointment is booked.");
    t = say(t.state, "use carrier C");
    expect(t.state.session.result.verdict).toBe("BLOCKED");
    const steps = nextSteps(t.state.session.result).map((s) => s.text).join(" ");
    expect(steps).toMatch(/Once the Red findings are fixed, Carrier C can collect/);
    expect(steps).not.toMatch(/Carrier C collects/);
    expect(confirmation(t.state.session.result)).toMatch(/Planned carrier once it's cleared/);
  });
});

describe("#2 the reply reflects the model's hazard check when it is part of the turn", () => {
  it("with an implied-hazard hint the reply warns and the verdict is never 'clear'", () => {
    const first = say(newChat(env), "Ship 200 phone chargers from London to a shop in Paris ready 05-11-2026, £6 each, 20 per carton, 0.1 kg each, HS 850440, made in China, 30 kg on 1 pallet, cheapest");
    const rowId = first.state.session.booking.items[0].rowId;
    // App re-runs the same turn once the hazard route answers; same patch, env now carries the hint
    const msg = "Ship 200 phone chargers from London to a shop in Paris ready 05-11-2026, £6 each, 20 per carton, 0.1 kg each, HS 850440, made in China, 30 kg on 1 pallet, cheapest";
    const st0 = newChat(env);
    const t = chatTurn(st0, extractLocal(msg, extractContext(st0, env.today)), msg, { ...env, hazardHints: { [rowId]: "implied" } }, "26-10-2026 10:00");
    expect(t.state.session.result.rules.find((r) => r.id === "R-06")!.status).toBe("fail");
    expect(t.state.session.result.verdict).toBe("BLOCKED");
    expect(t.reply).toMatch(/Heads-up/);
    expect(t.reply).not.toMatch(/Clear to ship/);
  });
});

describe("chargers are flagged deterministically (Local-only list), never left to model variance", () => {
  it("phone chargers -> implied hazard, R-06 Red pending confirmation", async () => {
    const { classifyHazard } = await import("@/lib/hazards");
    expect(classifyHazard("Phone chargers, USB-C").kind).toBe("implied");
    expect(classifyHazard("Ceramic coffee mug").kind).toBe("none");
  });
});
