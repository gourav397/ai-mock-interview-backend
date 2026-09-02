// backend/utils/genLock.js
// GLOBAL LOCK: ek time me sirf EK Gemini bank-generation chalegi.
// Isse 429 storm khatam — warm / expand / cron kabhi ek sath nahi chalenge.

let busy = false;
const waiters = [];

async function withGenLock(fn) {
  if (busy) {
    await new Promise((resolve) => waiters.push(resolve));
  }
  busy = true;
  try {
    return await fn();
  } finally {
    busy = false;
    const next = waiters.shift();
    if (next) next();
  }
}

module.exports = { withGenLock };