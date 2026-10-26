import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatHs, tariffSearchUrl, tariffUrl } from "@/lib/hs";
import { checkHs } from "@/lib/server/tariff";

const heading = (ids: string[]) => ({
  data: { attributes: { description_plain: "Ceramic tableware, kitchenware" } },
  included: ids.map((id) => ({ type: "commodity", attributes: { goods_nomenclature_item_id: id, description_plain: "Tableware and kitchenware" } })),
});

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.doUnmock("@/lib/server/openrouter"); vi.doUnmock("@/lib/server/tariff"); });

describe("helpers", () => {
  it("official links and formatting", () => {
    expect(tariffUrl("691200")).toBe("https://www.trade-tariff.service.gov.uk/headings/6912");
    expect(tariffUrl("")).toBe(tariffSearchUrl);
    expect(formatHs("691200")).toBe("6912.00");
    expect(formatHs("6912")).toBe("6912");
  });
});

describe("checkHs: a suggested code must exist in the official tariff", () => {
  it("accepts a code that some commodity starts with, and returns the official wording", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(heading(["6912002100", "6912002111"])), { status: 200 })));
    const r = await checkHs("691200");
    expect(r.ok).toBe(true);
    expect(r.official).toMatch(/Ceramic tableware/);
  });
  it("rejects a code the tariff doesn't have (e.g. a retired subheading)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(heading(["9405210000", "9405290000"])), { status: 200 })));
    expect((await checkHs("940520")).ok).toBe(false);
  });
  it("never throws: 404, network error and bad input all mean 'not verified'", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    expect((await checkHs("111111")).ok).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect((await checkHs("222222")).ok).toBe(false);
    expect((await checkHs("12")).ok).toBe(false);
    expect((await checkHs("abcdef")).ok).toBe(false);
  });
});

describe("/api/hs", () => {
  const call = async (descriptions: string[], model: { index: number; code: string }[], valid: string[]) => {
    vi.doMock("@/lib/server/openrouter", () => ({
      callModel: async () => ({ ok: true, data: { results: model.map((m) => ({ ...m, reason: "" })) }, model: "google/test", costUsd: 0 }),
      FAILURE_TEXT: { rate_limited: "", upstream: "", missing_key: "", timeout: "", out_of_credits: "", bad_output: "" },
    }));
    vi.doMock("@/lib/server/tariff", () => ({ checkHs: async (c: string) => (valid.includes(c) ? { ok: true, official: `Official text for ${c}` } : { ok: false, official: null }) }));
    const { POST } = await import("@/app/api/hs/route");
    const res = await POST(new Request("http://x/api/hs", { method: "POST", body: JSON.stringify({ descriptions }) }));
    return res.json();
  };

  it("returns verified suggestions with a verify link; drops unknown codes and vague items", async () => {
    const j = await call(["mug", "desk lamp", "goods"], [{ index: 0, code: "6912.00" }, { index: 1, code: "940520" }, { index: 2, code: "" }], ["691200"]);
    expect(j.ok).toBe(true);
    const [mug, lamp, vague] = j.suggestions;
    expect([mug.code, mug.official, mug.url]).toEqual(["691200", "Official text for 691200", "https://www.trade-tariff.service.gov.uk/headings/6912"]);
    expect([lamp.code, lamp.official, lamp.note]).toEqual([null, null, expect.stringMatching(/couldn't find a matching code/)]);
    expect([vague.code, vague.note]).toEqual([null, expect.stringMatching(/too vague/)]);
    for (const s of [lamp, vague]) expect(s.url).toBe(tariffSearchUrl);
  });
  it("rejects malformed and oversized requests", async () => {
    const { POST } = await import("@/app/api/hs/route");
    const bad = await POST(new Request("http://x/api/hs", { method: "POST", body: JSON.stringify({ descriptions: [] }) }));
    expect(bad.status).toBe(400);
    const big = await POST(new Request("http://x/api/hs", { method: "POST", body: "x".repeat(40_000) }));
    expect(big.status).toBe(413);
  });
});

describe("a suggestion is never applied by itself", () => {
  beforeEach(() => vi.resetModules());
  it("the engine has no path that writes a suggested code: only the seller's explicit edit changes hsCode", async () => {
    const { validateBooking } = await import("@/lib/validate");
    const { loadFixture } = await import("./helpers/loadFixture");
    const b = loadFixture("f01-r01-hs-code.xlsx").bookings[0];
    const res = validateBooking({ ...b, items: b.items.map((i) => ({ ...i, hsCode: null })) }, { today: "2026-10-25" });
    expect(res.rules.find((r) => r.id === "R-01")!.status).toBe("fail");
    expect(res.repairs.find((r) => r.rules.includes("R-01"))!.changes).toEqual([]);
    expect(res.repairs.find((r) => r.rules.includes("R-01"))!.applyEnabled).toBe(false);
  });
});
