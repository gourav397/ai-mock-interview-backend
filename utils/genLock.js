// GLOBAL LOCK: ek time me sirf EK Gemini bank-generation chalegi.
// Promise-chain based — race-free.

let chain = Promise.resolve();

function withGenLock(fn) {
  const run = chain.then(() => fn());
  // chain me error propagate na ho, sirf result aage jaye
  chain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

module.exports = { withGenLock };