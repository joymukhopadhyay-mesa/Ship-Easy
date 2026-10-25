// Manual live check against a running dev server (real model, costs a few tenths of a cent).
// Run: node scripts/live-model-check.mjs [baseUrl]
const base = process.argv[2] ?? "http://localhost:3100";
const post = async (body) => (await fetch(base + "/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ today: "2026-10-25", ...body }) })).json();
const cases = [
  ["non-divisible quantity", { message: "I'm sending 1,000 ceramic mugs from London to a warehouse in Berlin, 12 per carton, £5 each", context: { expecting: [], items: [], pendingChoice: false } },
    (j) => { const f = j.patch.items[0]?.fields ?? {}; return f.quantity?.value === 1000 && f.unitsPerCarton?.value === 12 && !("cartons" in f); }],
  ["answer (b) to the pending choice", { message: "(b) please", context: { expecting: [{ field: "choice", sku: "MUG-01" }], items: [{ sku: "MUG-01", description: "ceramic mugs" }], pendingChoice: true } },
    (j) => j.patch.choice?.value === "b"],
  ["seller override onto Carrier C", { message: "actually let's go with carrier C", context: { expecting: [], items: [{ sku: "JAR-01", description: "glass jars" }], pendingChoice: false } },
    (j) => j.patch.set.chosenCarrier?.value === "C" && Object.keys(j.patch.set).length === 1 && j.patch.items.length === 0],
  ["mid-conversation change", { message: "oh and make it 4 pallets, same weight", context: { expecting: [], items: [{ sku: "BOARD-01", description: "wooden chopping boards" }], pendingChoice: false } },
    (j) => j.patch.set.pallets?.value === 4 && !("grossWeight" in j.patch.set)],
];
let failed = 0;
for (const [name, body, check] of cases) {
  const j = await post(body);
  const pass = j.ok && check(j);
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  model=${j.model ?? "-"} cost=$${j.costUsd ?? "-"}  set=${JSON.stringify(j.patch?.set ?? j.reason)} items=${JSON.stringify(j.patch?.items ?? [])}`);
}
process.exit(failed ? 1 : 0);
