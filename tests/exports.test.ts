import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { correctedWorkbook } from "@/lib/exportXlsx";
import { invoiceDraft } from "@/lib/invoice";
import { parseWorkbook } from "@/lib/parse";
import { reportHtml } from "@/lib/report";
import { applyEdits, newSession } from "@/lib/session";
import { validateWorkbook } from "@/lib/validate";

const env = { today: "2026-10-25" };
const sample = () => parseWorkbook(new Uint8Array(fs.readFileSync(path.resolve(__dirname, "../public/sample-bookings.xlsx"))));

describe("sample file (Load sample file button)", () => {
  it("every row accounted for, planned verdicts", () => {
    const out = validateWorkbook(sample(), env);
    expect(out.reconciliation.line).toBe("23 rows read, 20 validated, 1 unmatched, 2 incomplete");
    expect(Object.fromEntries(out.results.map((r) => [r.booking.bookingId, r.verdict]))).toEqual({
      "BK-101": "CLEAR TO SHIP", "BK-102": "BLOCKED", "BK-103": "BLOCKED", "BK-104": "BLOCKED", "BK-105": "BLOCKED", "BK-106": "BLOCKED",
      "BK-107": "BLOCKED", "BK-108": "BLOCKED", "BK-109": "INCOMPLETE", "BK-111": "SHIP WITH CARE", "BK-110": "INCOMPLETE",
    });
  });
});

describe("downloads", () => {
  it("corrected .xlsx round-trips through the parser with the applied fix", () => {
    const parsed = sample();
    const sessions = parsed.bookings.map((b) => newSession("file", b, env));
    const k = sessions.findIndex((s) => s.booking.bookingId === "BK-102");
    const fix = sessions[k].result.repairs[0];
    expect(fix.confidence).toBe("High");
    const map = { "booking.declared_value": "declaredValue", "item.quantity": "item.quantity" } as const;
    sessions[k] = applyEdits(sessions[k], fix.changes.map((c) => ({ path: map[c.field as keyof typeof map], rowId: c.rowId, value: c.to as number })), "apply", env, "25-10-2026 12:00").session;
    const buf = correctedWorkbook(sessions.map((s) => s.result));
    const again = validateWorkbook(parseWorkbook(new Uint8Array(buf)), env);
    expect(again.results.find((r) => r.booking.bookingId === "BK-102")!.verdict).toBe("CLEAR TO SHIP");
    expect(again.results.length).toBe(11);
    // orphans are not re-exported (they belong to no booking); the zero-item booking stays incomplete
    expect(again.reconciliation.line).toBe("22 rows read, 20 validated, 0 unmatched, 2 incomplete");
  });

  it("report contains verdicts, findings, carrier, confirmation, next steps and the reconciliation", () => {
    const out = validateWorkbook(sample(), env);
    const html = reportHtml({ title: "t", today: env.today, results: out.results, logs: [], reconciliation: out.reconciliation.line, orphans: out.orphans });
    for (const s of ["23 rows read, 20 validated, 1 unmatched, 2 incomplete", "BK-102", "BLOCKED", "R-02", "Confidence: High".replace("Confidence: ", "confidence: "), "What happens next", "Commercial invoice - draft", "BK-999"]) expect(html).toContain(s);
  });

  it("invoice draft: 8 of 13 customs fields populated for a complete booking", () => {
    const out = validateWorkbook(sample(), env);
    const inv = invoiceDraft(out.results[0].booking);
    expect(inv.title).toBe("Commercial invoice - draft, 8 of 13 customs fields populated");
    expect(inv.fields.filter((f) => !f.value).map((f) => f.label)).toEqual(["Buyer / consignee name and address", "Exporter EORI and buyer VAT number", "Invoice number and date", "Incoterms and payment terms", "Signature"]);
  });
});
