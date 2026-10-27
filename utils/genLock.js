
"use strict";

// Global Gemini generation queue.
// A queued task that exceeds its waiting deadline is skipped.
// An already-running task is not forcibly cancelled by this lock.

let chain = Promise.resolve();

const DEFAULT_MAX_WAIT_MS = 90000;

function withGenLock(fn, options = {}) {
  if (typeof fn !== "function") {
    return Promise.reject(
      new TypeError("withGenLock expects a function")
    );
  }

  const configuredWait = Number(options.waitTimeoutMs);

  const maxWaitMs =
    Number.isFinite(configuredWait) && configuredWait > 0
      ? configuredWait
      : DEFAULT_MAX_WAIT_MS;

  let started = false;
  let expired = false;
  let timer = null;

  const run = chain.then(async () => {
    if (expired) {
      const error = new Error(
        `Generation queue wait exceeded ${maxWaitMs}ms`
      );
      error.code = "GENERATION_QUEUE_TIMEOUT";
      throw error;
    }

    started = true;

    if (timer) {
      clearTimeout(timer);
      timer = null;
    }

    return fn();
  });

  // Keep the queue alive even when a task fails.
  chain = run.then(
    () => undefined,
    () => undefined
  );

  return new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      if (started) return;

      expired = true;

      const error = new Error(
        `Generation queue wait exceeded ${maxWaitMs}ms`
      );
      error.code = "GENERATION_QUEUE_TIMEOUT";

      reject(error);
    }, maxWaitMs);

    run.then(
      (result) => {
        if (timer) clearTimeout(timer);
        resolve(result);
      },
      (error) => {
        if (timer) clearTimeout(timer);
        reject(error);
      }
    );
  });
}

module.exports = { withGenLock };
