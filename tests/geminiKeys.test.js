// node tests/geminiKeys.test.js
const { parseKeys, KeyManager, maskKey } = require("../config/geminiKeys");

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`✅ ${name}`); }
  else { fail++; console.log(`❌ ${name}`); }
}

// TEST 1: no variable
check("TEST 1 — missing env → 0 keys", parseKeys("").length === 0);

// TEST 2-4: 1 / 2 / 10 keys
check("TEST 2 — 1 key", parseKeys("KEY1").length === 1);
check("TEST 3 — 2 keys", parseKeys("KEY1,KEY2").length === 2);
check("TEST 4 — 10 keys", parseKeys("K1,K2,K3,K4,K5,K6,K7,K8,K9,K10").length === 10);

// TEST 5: spaces after commas
const t5 = parseKeys("KEY1, KEY2 ,  KEY3  ");
check("TEST 5 — spaces trimmed", t5.length === 3 && t5.every(k => !k.includes(" ")));

// TEST 6: empty entries
check("TEST 6 — empty entries ignored", parseKeys("KEY1,,KEY2,,KEY3").length === 3);

// bonus: quoted paste + newline paste (Render common issue)
check("BONUS — quoted value stripped", parseKeys('"KEY1,KEY2"').join("|") === "KEY1|KEY2");
check("BONUS — multiline paste", parseKeys("KEY1\nKEY2\nKEY3").length === 3);

// TEST 7: one key fails → next attempted
const km7 = new KeyManager(["A", "B", "C"]);
km7.markInvalid(0, "403");
const s7 = km7.nextKey();
check("TEST 7 — invalid key skipped", !!s7 && s7.key === "B" && s7.index === 1);

// TEST 8: 429 cooldown → fallback, cooldown key skip
const km8 = new KeyManager(["A", "B"], { cooldownMs: 60000 });
km8.markSuccess(0);
km8.markRateLimited(0, { waitMs: 60000 });
const s8 = km8.nextKey();
check("TEST 8a — 429 key skipped (fallback)", !!s8 && s8.key === "B");
check("TEST 8b — cooldown key wapas after expiry", (() => {
  km8.cooldownUntil[0] = Date.now() - 1;
  const s = km8.nextKey();
  return !!s && s.key === "A";
})());

// daily exhaustion
const km9 = new KeyManager(["A", "B"]);
km9.markRateLimited(0, { isDaily: true });
km9.markRateLimited(1, { isDaily: true });
check("TEST — all daily-exhausted → isQuotaExhausted()", km9.isQuotaExhausted());

// security: mask
check("SECURITY — key masked", maskKey("AIzaSyD0exampleKey123456789").includes("..."));

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);