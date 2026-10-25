// R-06 classification data. Explicit = the description names a lithium battery,
// aerosol or flammable liquid. Implied = the product class normally contains one.
// The keyword list and built-in implied list make R-06 work in Local-only mode; the
// model may only ADD an "implied" classification, never remove one.
import type { HazardKind } from "./types";

export const EXPLICIT_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\blithium(?:[-\s]ion|[-\s]polymer)?\b/i, label: "lithium battery" },
  { re: /\bli[-\s]?ion\b/i, label: "lithium-ion battery" },
  { re: /\bli[-\s]?po(?:ly)?\b/i, label: "lithium-polymer battery" },
  { re: /\baerosols?\b/i, label: "aerosol" },
  { re: /\bspray\s?cans?\b/i, label: "aerosol" },
  { re: /\bflammable\b/i, label: "flammable liquid" },
  { re: /\binflammable\b/i, label: "flammable liquid" },
  { re: /\blighter\s+fluid\b/i, label: "flammable liquid" },
  { re: /\b(?:petrol|gasoline|kerosene|paraffin|white spirit|methylated spirits?|acetone|butane|propane)\b/i, label: "flammable liquid/gas" },
];

export const IMPLIED_PRODUCTS: { re: RegExp; label: string }[] = [
  { re: /\b(?:wireless|bluetooth|true wireless|tws)\s+(?:ear\s?buds?|earphones?|headphones?|headsets?)\b/i, label: "wireless earbuds (lithium battery)" },
  { re: /\bear\s?buds?\b/i, label: "earbuds (usually a lithium battery)" },
  { re: /\bbluetooth\s+speakers?\b/i, label: "Bluetooth speaker (lithium battery)" },
  { re: /\b(?:portable|wireless|smart)\s+speakers?\b/i, label: "portable speaker (lithium battery)" },
  { re: /\bcordless\s+(?:vacuum|hoover|drill|screwdriver|saw|tool|trimmer|hedge|blower|stick)/i, label: "cordless appliance (lithium battery)" },
  { re: /\b(?:power\s?bank|portable charger|battery pack)s?\b/i, label: "power bank (lithium battery)" },
  { re: /\b(?:smart\s?watch|fitness tracker|smart\s?phone|mobile phone|laptop|tablet|e-?reader|drone|e-?bike|e-?scooter|hoverboard|vape|e-?cig(?:arette)?s?)\b/i, label: "electronic device (lithium battery)" },
  { re: /\bbatter(?:y|ies)\b/i, label: "battery (may be lithium)" },
  { re: /\bnail\s+(?:polish|varnish|lacquer)(?:\s+remover)?\b/i, label: "nail polish (flammable liquid)" },
  { re: /\bhand\s+saniti[sz]er\b/i, label: "hand sanitiser (flammable, alcohol-based)" },
  { re: /\b(?:perfume|eau de (?:parfum|toilette)|cologne|fragrance spray|body spray)\b/i, label: "perfume (flammable liquid)" },
  { re: /\b(?:hair\s?spray|dry shampoo|deodorant spray|spray deodorant|spray paint|spray polish|shaving foam)\b/i, label: "pressurised spray (aerosol)" },
  { re: /\b(?:lighters?|matches|fire\s?starters?|camping gas|gas canisters?)\b/i, label: "lighter/fuel (flammable)" },
  { re: /\b(?:paint thinner|solvent|varnish|lacquer|wood stain|rubbing alcohol|isopropyl|surgical spirit|essential oils?)\b/i, label: "flammable liquid" },
];

export function classifyHazard(description: string): { kind: HazardKind; matched: string | null } {
  const d = description ?? "";
  for (const p of EXPLICIT_PATTERNS) if (p.re.test(d)) return { kind: "explicit", matched: p.label };
  for (const p of IMPLIED_PRODUCTS) if (p.re.test(d)) return { kind: "implied", matched: p.label };
  return { kind: "none", matched: null };
}
