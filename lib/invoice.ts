// Commercial invoice DRAFT (P2): shows which of 13 customs fields the booking sheet can
// fill and highlights the rest as blanks. The gap itself is a finding.
import { fmtNum, gbp } from "./format";
import type { Booking } from "./types";

export interface InvoiceField {
  label: string;
  value: string | null;
}

export function invoiceDraft(b: Booking): { fields: InvoiceField[]; populated: number; total: number; title: string } {
  const lines = b.items;
  const all = <T,>(f: (i: Booking["items"][number]) => T | null | undefined) => lines.length > 0 && lines.every((i) => f(i) != null && f(i) !== "");
  const fields: InvoiceField[] = [
    { label: "Exporter (seller)", value: b.sellerName },
    { label: "Ship from", value: b.originCity ? `${b.originCity}, ${b.originCountry ?? "United Kingdom"}` : null },
    { label: "Ship to", value: b.destinationCity ? `${b.destinationCity}${b.destinationCountry ? ", " + b.destinationCountry : ""}${b.destinationType ? ` (${b.destinationType})` : ""}` : null },
    { label: "Description of goods", value: all((i) => i.description) ? lines.map((i) => i.description).join("; ") : null },
    { label: "HS code per line", value: all((i) => i.hsCode) ? lines.map((i) => `${i.sku}: ${i.hsCode}`).join("; ") : null },
    { label: "Quantity per line", value: all((i) => i.quantity) ? lines.map((i) => `${i.sku}: ${fmtNum(i.quantity)}`).join("; ") : null },
    { label: "Unit price and total value", value: all((i) => i.unitPrice) && b.declaredValue != null ? `${lines.map((i) => `${i.sku} ${gbp(i.unitPrice)}`).join("; ")} — total ${gbp(b.declaredValue)} (GBP)` : null },
    { label: "Country of origin per line", value: all((i) => i.countryOfOrigin) ? lines.map((i) => `${i.sku}: ${i.countryOfOrigin}`).join("; ") : null },
    { label: "Buyer / consignee name and address", value: null },
    { label: "Exporter EORI and buyer VAT number", value: null },
    { label: "Invoice number and date", value: null },
    { label: "Incoterms and payment terms", value: null },
    { label: "Signature", value: null },
  ];
  const populated = fields.filter((f) => f.value).length;
  return { fields, populated, total: fields.length, title: `Commercial invoice - draft, ${populated} of ${fields.length} customs fields populated` };
}
