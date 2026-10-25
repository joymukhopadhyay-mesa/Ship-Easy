// Chat guardrails (deterministic, run on every message whether or not the model is used).
// They decide whether a message is a shipment booking at all, refuse prohibited goods and
// attempts to re-instruct the assistant, flag places outside the lane, and reject values
// that cannot be real. They never create a Red/Amber: the rulebook stays the only source.
import { DESTINATION_CITIES, ORIGIN_CITIES } from "./config";
import { addDays, isIsoDate } from "./dates";
import type { Slot } from "./localExtract";

export type Intent = "booking" | "off_topic" | "injection" | "prohibited" | "question" | "empty";

export interface Screen {
  intent: Intent;
  reply?: string;
}

const INJECTION = /\b(?:ignore|disregard|forget|override)\b[^.]{0,40}\b(?:instructions?|rules?|prompt|previous|above|everything)\b|\bsystem prompt\b|\bdeveloper mode\b|\bjail ?break\b|\byou are now\b|\bact as\b|\bpretend (?:to be|you)\b|\b(?:reveal|show|print)\b[^.]{0,20}\b(?:prompt|instructions|api key|secret)\b|\bmark (?:it|this|the booking) (?:as )?(?:clear|approved|passed)\b|\bset (?:the )?verdict\b/i;

const PROHIBITED = /\b(?:firearms?|rifles?|shotguns?|handguns?|revolvers?|ammunition|ammo|explosives?|grenades?|detonators?|dynamite|tnt|gunpowder|cocaine|heroin|cannabis|marijuana|methamphetamine|fentanyl|mdma|ivory|counterfeit)\b|(?<!(?:glue|staple|nail|heat|hot|massage|water|toy|spray|caulk|caulking|paint|grease|tape|nerf|bubble|price|tattoo|soldering|foam|squirt|label)[\s-]?)\b(?:guns?|pistols?)\b(?![\s-]?(?:metal|grey|gray|shy))|(?<!(?:bath|seed|fizz|glitter|smoke|flavour|flavor|cocoa|chocolate|hot chocolate)[\s-]?)\bbombs?\b/i;

/** Clear consumer / chit-chat requests that are not a freight booking. */
const OFF_TOPIC = [
  /\b(?:order|get me|can i (?:get|have|order)|i(?:'d| would) like|i want|buy me|deliver me)\b[^.]{0,40}\b(?:pizzas?|burgers?|coffees?|food|takeaway|meals?|sushi|kebabs?|curry|drinks?|taxi|uber|cab|ride|tickets?|flights?|hotel)\b/i,
  /\b(?:tell me a joke|joke|poem|story|song|recipe|homework|weather|forecast|capital of|who (?:are|made) you|what(?:'s| is) your name|how are you|meaning of life|football|horoscope)\b/i,
  /\b(?:uber|taxi|cab|lift|ride) to\b/i,
];

/** Words that show the message is about moving goods (strong enough to override a loose off-topic match). */
const SHIPPING = /\b(?:ship(?:s|ped|ping|ment|ments)?|send(?:s|ing)?|sent|export(?:s|ed|ing)?|quote|freight|cargo|consignment|pallets?|cartons?|boxes|cases|kg|kilos?|tonnes?|warehouse|fulfil?ment|distribution cent(?:re|er)|collect(?:ed|ion)?|deliver(?:s|ed|ing|y|ies)?|units?|pcs|hs ?code|made in|declared|gross weight|booking|carrier|appointment)\b|£\s?\d/i;

const GREETING = /^\s*(?:hi|hello|hey|hiya|good (?:morning|afternoon|evening)|yo|thanks?|thank you|ok(?:ay)?|cool|great)[\s!.,]*$/i;
const QUESTION = /\b(?:why|what(?:'s| is) wrong|explain|how do i fix|what (?:do|should) i do|what happens next|help)\b/i;

const hasLetters = (s: string) => /[a-z]{2,}/i.test(s);

/**
 * Classifies one seller message. `extracted` = whether the extractor found any usable field;
 * `expecting` = the questions just asked (a bare "3" or "China" is a valid answer to them).
 */
export function screenMessage(message: string, opts: { extracted: boolean; expecting: Slot[]; hasBooking: boolean; modelIntent?: string | null }): Screen {
  const m = message.trim();
  if (INJECTION.test(m)) {
    return { intent: "injection", reply: "I can't change how I work or override the checks. Every verdict comes from the fixed rulebook and the numbers you give me. Tell me about your shipment and I'll check it." };
  }
  const prohibited = PROHIBITED.exec(m);
  if (prohibited) {
    return { intent: "prohibited", reply: `I can't help book "${prohibited[0]}". Weapons, explosives, illegal drugs and similar goods can't be shipped with this service. Nothing was added to your booking.` };
  }
  const shipping = SHIPPING.test(m);
  if (!shipping && OFF_TOPIC.some((re) => re.test(m))) {
    return { intent: "off_topic", reply: "That doesn't look like a shipment. Ship Easy books business freight from the UK (London, Manchester, Birmingham or Leeds) to Germany, France or the Netherlands, and checks it before it leaves. If you are shipping goods, tell me what, how many and where to — for example \"600 cast iron skillets to a warehouse in Hamburg\"." };
  }
  if (opts.modelIntent && ["off_topic", "injection", "prohibited"].includes(opts.modelIntent) && !shipping && !opts.extracted) {
    return { intent: "off_topic", reply: "That doesn't look like a shipment. Tell me what you're shipping, how many and where to, and I'll check it." };
  }
  if (!opts.extracted) {
    if (GREETING.test(m)) return { intent: "empty", reply: "Hi! Tell me what you're shipping, in your own words — for example \"600 cast iron skillets to a warehouse in Hamburg\"." };
    if (opts.hasBooking && QUESTION.test(m)) return { intent: "question" };
    if (!hasLetters(m) && !/\d/.test(m)) return { intent: "empty", reply: "I couldn't read that. Tell me what you're shipping and where to — for example \"1,080 ceramic mugs to Berlin\"." };
    return { intent: "empty" };
  }
  return { intent: "booking" };
}

/** Places mentioned that are outside the lane (UK collection cities -> DE/FR/NL cities). */
export function placeNotes(message: string): string[] {
  const notes: string[] = [];
  const dest = Object.keys(DESTINATION_CITIES);
  const from = /\bfrom\s+([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?)/.exec(message);
  if (from) {
    const place = from[1];
    const isUk = ORIGIN_CITIES.some((c) => c.toLowerCase() === place.toLowerCase()) || /^(?:the )?(?:uk|united kingdom|england|britain)$/i.test(place);
    const isMadeIn = /^(?:china|india|vietnam|turkey|germany)$/i.test(place); // "from China" = where goods were made
    if (!isUk && !isMadeIn) notes.push(`Collection has to be in the UK (London, Manchester, Birmingham or Leeds), so I haven't used "${place}" as the origin.`);
  }
  const toRe = /\b(?:to|into|in)\s+(?:a\s+|our\s+|their\s+|the\s+)?(?:warehouse|shop|store|office|dc|fulfil?ment centre)?\s*(?:in\s+)?([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = toRe.exec(message))) {
    const place = m[1];
    if (dest.some((c) => c.toLowerCase() === place.toLowerCase())) continue;
    if (ORIGIN_CITIES.some((c) => c.toLowerCase() === place.toLowerCase())) continue;
    if (/^(?:Germany|France|Netherlands|Holland|UK|United|England|Britain|I|We|Our|The|A|My|Carrier|Warehouse|Mon|Tue|Wed|Thu|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|June|July|August|September|October|November|December|Total|Cheapest|Fastest|Balanced)$/.test(place)) continue;
    notes.push(`I can only book deliveries to Berlin, Frankfurt, Hamburg, Paris, Lyon, Amsterdam or Rotterdam, so "${place}" can't be used as the destination.`);
    break;
  }
  return notes;
}

/** Hard plausibility limits for typed values. Outside them the value is not used and the question is asked again. */
const LIMITS: Record<string, { min: number; max: number; integer?: boolean; label: string }> = {
  pallets: { min: 1, max: 100, integer: true, label: "pallets" },
  grossWeight: { min: 1, max: 100000, label: "gross weight (kg)" },
  quantity: { min: 1, max: 10000000, integer: true, label: "quantity" },
  unitPrice: { min: 0.01, max: 1000000, label: "unit price (GBP)" },
  unitsPerCarton: { min: 1, max: 100000, integer: true, label: "units per carton" },
  cartons: { min: 1, max: 1000000, integer: true, label: "cartons" },
  unitWeight: { min: 0.001, max: 5000, label: "unit weight (kg)" },
};

/** null = fine; otherwise a plain-English reason the value can't be used. */
export function implausible(field: string, value: number): string | null {
  const l = LIMITS[field];
  if (!l) return null;
  if (!Number.isFinite(value)) return `${l.label} must be a number`;
  if (l.integer && !Number.isInteger(value)) return `${l.label} must be a whole number`;
  if (value < l.min) return `${l.label} must be at least ${l.min.toLocaleString("en-GB")}`;
  if (value > l.max) return `${l.label} of ${value.toLocaleString("en-GB")} is more than this service can take (max ${l.max.toLocaleString("en-GB")})`;
  return null;
}

/** Ready dates more than a year ahead (or over a year ago) are almost certainly typos. */
export function implausibleDate(iso: string, today: string): string | null {
  if (!isIsoDate(iso)) return "that isn't a real date";
  if (iso > addDays(today, 365)) return "that's more than a year ahead; bookings can be made up to 12 months out";
  if (iso < addDays(today, -365)) return "that's more than a year ago";
  return null;
}
