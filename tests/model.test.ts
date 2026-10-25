import { afterEach, describe, expect, it, vi } from "vitest";
import { chatOutToPatch, hazardHints, ChatOut } from "@/lib/modelContract";
import { sanitisePatch } from "@/lib/patch";
import { callModel } from "@/lib/server/openrouter";

const ok = (content: unknown, model = "google/gemini-3.7-flash") => new Response(JSON.stringify({ model, choices: [{ message: { content: JSON.stringify(content) } }], usage: { cost: 0 } }), { status: 200 });
const opts = { name: "t", schema: {}, system: "s", user: "u", validate: (x: unknown) => (x && typeof x === "object" && "a" in x ? (x as { a: number }) : null) };

afterEach(() => { vi.unstubAllGlobals(); delete process.env.OPENROUTER_API_KEY; });

describe("model client (OpenRouter, Google models only) degrades, never throws", () => {
  it("missing key -> missing_key without any network call", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await callModel(opts)).toEqual({ ok: false, reason: "missing_key" });
    expect(f).not.toHaveBeenCalled();
  });
  it("429 is retried with backoff, then reported as rate_limited", async () => {
    process.env.OPENROUTER_API_KEY = "test";
    const f = vi.fn(async () => new Response("{}", { status: 429 }));
    vi.stubGlobal("fetch", f);
    const r = await callModel(opts);
    expect(r).toEqual({ ok: false, reason: "rate_limited" });
    expect(f.mock.calls.length).toBeGreaterThanOrEqual(3);
  }, 20000);
  it("402 stops immediately", async () => {
    process.env.OPENROUTER_API_KEY = "test";
    const f = vi.fn(async () => new Response("{}", { status: 402 }));
    vi.stubGlobal("fetch", f);
    expect(await callModel(opts)).toEqual({ ok: false, reason: "out_of_credits" });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("404 on the primary model falls back to the fallback Google model; request is provider-pinned", async () => {
    process.env.OPENROUTER_API_KEY = "test";
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => {
      const b = JSON.parse(String(init.body));
      bodies.push(b);
      return bodies.length === 1 ? new Response("{}", { status: 404 }) : ok({ a: 1 }, b.model);
    }));
    const r = await callModel(opts);
    expect(r.ok && r.data).toEqual({ a: 1 });
    expect(bodies.map((b) => b.model)).toEqual(["google/gemini-3.7-flash", "google/gemini-3.5-flash-lite"]);
    for (const b of bodies) {
      expect(String(b.model).startsWith("google/")).toBe(true);
      expect(b.provider).toEqual({ only: ["google-vertex", "google-ai-studio"], allow_fallbacks: false, require_parameters: true });
      expect((b.response_format as { type: string }).type).toBe("json_schema");
    }
  });
  it("output that fails validation -> bad_output (after trying the fallback model)", async () => {
    process.env.OPENROUTER_API_KEY = "test";
    vi.stubGlobal("fetch", vi.fn(async () => ok({ nope: true })));
    expect(await callModel(opts)).toEqual({ ok: false, reason: "bad_output" });
  });
});

describe("model output is still guarded by the allow-list and source check", () => {
  it("a hallucinated value and a forbidden field are dropped", () => {
    const out = ChatOut.parse({
      set: [{ field: "pallets", value: "+1", source: "add another pallet" }, { field: "grossWeight", value: "2000", source: "2 tonnes" }, { field: "declaredValue", value: "9", source: "pallet" }],
      items: [], choice: "", choice_source: "", declined: [], questions_answered: [],
    });
    const { patch, rejected } = sanitisePatch(chatOutToPatch(out), "please add another pallet");
    expect(patch.set).toEqual({ pallets: { value: "+1", source: "add another pallet" } });
    expect(rejected.map((r) => r.reason).sort()).toEqual(["field not allowed", "not in latest message"]);
  });
  it("hazard hints can only add 'implied'", () => {
    expect(hazardHints(["a", "b", "c"], { results: [{ index: 0, kind: "none", reason: "" }, { index: 1, kind: "implied", reason: "" }, { index: 2, kind: "explicit", reason: "" }] })).toEqual({ b: "implied", c: "implied" });
  });
});
