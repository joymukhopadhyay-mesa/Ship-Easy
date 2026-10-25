// One-off: generates the truck/van artwork in public/img with Google's image model via OpenRouter.
// Run: node --env-file=.env.local scripts/gen-images.mjs   (costs ~ $0.08 per image)
import fs from "node:fs";
const key = process.env.OPENROUTER_API_KEY;
if (!key) { console.error("OPENROUTER_API_KEY missing"); process.exit(1); }
const style = "Photorealistic studio product render, isolated on a pure white background (#FFFFFF), soft natural contact shadow under the wheels, no text, no logos, no people, no watermark, clean modern logistics brand style, high detail, centred, generous empty margin around the vehicle.";
const jobs = [
  ["truck-hero.png", `A modern European semi truck (tractor unit with a long plain cream-white box trailer), three-quarter front-left view, white cab. ${style}`],
  ["truck-box.png", `A white medium-size rigid box truck for pallet deliveries, side profile view facing right, plain white box body. ${style}`],
  ["van.png", `A white modern panel delivery van, three-quarter front-right view. ${style}`],
];
let total = 0;
for (const [file, prompt] of jobs) {
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "google/gemini-3.1-flash-image", modalities: ["image", "text"], messages: [{ role: "user", content: prompt }],
      provider: { only: ["google-vertex", "google-ai-studio"], allow_fallbacks: false } }),
  });
  const j = await r.json();
  if (j.error) { console.error(file, "ERROR", JSON.stringify(j.error).slice(0, 300)); continue; }
  const url = j.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url) { console.error(file, "no image returned", JSON.stringify(j).slice(0, 300)); continue; }
  fs.writeFileSync(`public/img/${file}`, Buffer.from(url.split(",")[1], "base64"));
  const cost = j.usage?.cost_details?.upstream_inference_cost ?? j.usage?.cost ?? 0;
  total += cost;
  console.log(`${file}: model=${j.model} cost=$${cost} bytes=${fs.statSync(`public/img/${file}`).size}`);
}
console.log(`total cost $${total.toFixed(4)}`);
