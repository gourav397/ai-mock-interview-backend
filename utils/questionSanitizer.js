// utils/questionSanitizer.js
// 🔥 AI se aaye bekar questions ko clean karta hai:
//  - duplicate options hatao (Hisar, Hisar, Hisar, Hisar)
//  - jiska answer options me NAHI hai → question drop
//  - same question 2 baar ho → drop

function cleanText(s) {
  return String(s || "").trim();
}

function optionKey(text) {
  return cleanText(text).toLowerCase();
}

// 1 question clean karo — bekar ho to null return
function cleanQuestion(raw) {
  if (!raw || typeof raw !== "object") return null;

  const question = cleanText(raw.question);
  if (!question) return null;

  // ---- options de-duplicate ----
  const seen = new Set();
  const options = [];
  const rawOptions = Array.isArray(raw.options) ? raw.options : [];

  for (const o of rawOptions) {
    const text = cleanText(o && o.text);
    if (!text) continue;
    const key = optionKey(text);
    if (seen.has(key)) continue; // duplicate option hatao
    seen.add(key);
    options.push({
      text,
      info: cleanText((o && o.info) || "")
    });
  }

  // kam se kam 2 unique options chahiye, warna question drop
  if (options.length < 2) return null;

  const correct = cleanText(raw.correctAnswer);
  if (!correct) return null;

  // ---- kya correctAnswer options me hai? ----
  const exact = options.find((o) => optionKey(o.text) === optionKey(correct));
  if (exact) {
    return { question, options, correctAnswer: exact.text };
  }

  // fuzzy match — AI kabhi kabhi thoda alag likh deta hai
  const fuzzy = options.find(
    (o) =>
      optionKey(o.text).includes(optionKey(correct)) ||
      optionKey(correct).includes(optionKey(o.text))
  );
  if (fuzzy) {
    return { question, options, correctAnswer: fuzzy.text };
  }

  // answer options me nahi → drop
  return null;
}

// poora bank sanitize karo + same-question repeats hatao
function sanitizeBank(questions) {
  if (!Array.isArray(questions)) return [];
  const seenQ = new Set();
  const cleaned = [];
  for (const q of questions) {
    const c = cleanQuestion(q);
    if (!c) continue;
    const k = optionKey(c.question).split(" / ")[0];
    if (!k || seenQ.has(k)) continue;
    seenQ.add(k);
    cleaned.push(c);
  }
  return cleaned;
}

module.exports = { cleanQuestion, sanitizeBank };