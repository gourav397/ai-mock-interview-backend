// ============================================================
// ALEX BRAIN — CENTRAL REASONING / ORCHESTRATION ENGINE
// Version: 1.0.0
//
// PURPOSE:
//   Single orchestrator for the full autonomous cycle:
//   GOAL → UNDERSTAND → MEMORY → OBSERVE → REASON → PLAN
//   → EXECUTE → VERIFY → RECOVER/REPLAN → LEARN → REPORT
//
// DESIGN RULES:
//   ✓ Does NOT replace existing components — it orchestrates
//     IntentRouter/DecisionEngine/TaskService/ChatMemory/
//     LearningStore/WorldAwareness through the EventBus.
//   ✓ Owner-scoped everywhere (ownerKey).
//   ✓ Every phase emits events (full audit trail).
//   ✓ No fake capabilities: plans only from real tools.
//   ✓ Never throws — structured results to owner.
// ============================================================

const { getEventBus, EVENTS } = require("./EventBus");
const { getLearningStore } = require("./LearningStore");
const { getWorldAwareness } = require("./WorldAwareness");
const { getChatMemory } = require("./ChatMemory");           // existing
const { getAutonomousTaskService } = require("./AutonomousTaskService"); // existing

const MAX_REPLAN_CYCLES = 3;

class AlexBrain {
  constructor({ gemini = null } = {}) {
    this.gemini = gemini;
    this.eventBus = getEventBus();
    this.memory = getChatMemory();
    this.learning = getLearningStore();
    this.world = getWorldAwareness({ gemini });
    this.tasks = getAutonomousTaskService();
  }

  // ==========================================================
  // MAIN ENTRY — owner gives a goal
  // ==========================================================
  async processOwnerGoal({ ownerKey, goal, sessionId = null, context = {} }) {
    const cycleId = `brain-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = Date.now();

    this.eventBus.emit(EVENTS.USER_GOAL_RECEIVED, { goal, cycleId },
      { ownerId: ownerKey, sessionId, source: "AlexBrain" });

    try {
      // ---------- PHASE 1: UNDERSTAND ----------
      const understanding = await this._understand(ownerKey, goal, sessionId);
      if (!understanding.ok) {
        return this._report(cycleId, startedAt, {
          status: "needs_clarification",
          message: understanding.message || "Goal samajh nahi aaya — thoda detail mein batao.",
        });
      }

      // ---------- PHASE 2: MEMORY RETRIEVAL ----------
      const experiences = this.learning.retrieveRelevant(ownerKey, goal, { limit: 5 });
      this.eventBus.emit(EVENTS.MEMORY_RETRIEVED,
        { count: experiences.length, cycleId },
        { ownerId: ownerKey, sessionId, source: "AlexBrain" });

      // ---------- PHASE 3: WORLD OBSERVATION ----------
      let worldContext = null;
      if (understanding.needsFreshData) {
        const obs = await this.world.observeForGoal(goal);
        if (obs) worldContext = obs;
        this.eventBus.emit(EVENTS.OBSERVATION_RECEIVED,
          { sources: obs ? obs.succeeded : 0, cycleId },
          { ownerId: ownerKey, sessionId, source: "AlexBrain" });
      }

      // ---------- PHASE 4: REASON + PLAN ----------
      const plan = await this._plan(ownerKey, goal, understanding, experiences, worldContext);
      if (!plan.ok) {
        return this._report(cycleId, startedAt, {
          status: "cannot_plan",
          message: plan.reason || "Is goal ke liye koi authorized capability available nahi hai. (No fake modules — sirf real implemented tools use hote hain.)",
        });
      }
      this.eventBus.emit(EVENTS.PLAN_CREATED,
        { steps: plan.steps.length, cycleId },
        { ownerId: ownerKey, sessionId, source: "AlexBrain" });

      // ---------- PHASE 5: EXECUTE VIA AUTONOMOUS TASK SERVICE ----------
      const taskResult = await this._execute(ownerKey, goal, plan, sessionId, cycleId);

      // ---------- PHASE 6: LEARN + REPORT ----------
      const experiencesForPrompt = this.learning.formatForPrompt(experiences);
      return this._report(cycleId, startedAt, {
        status: taskResult.ok ? "processing" : "failed",
        taskId: taskResult.taskId || null,
        message: taskResult.ok
          ? `Task start ho gaya (${plan.steps.length} steps planned). Main results observe karke report dunga.`
          : `Task start nahi ho paya: ${taskResult.error || "unknown error"}`,
        plan: plan.steps,
        pastExperience: experiences.length ? "relevant past experience applied" : null,
      });
    } catch (err) {
      return this._report(cycleId, startedAt, {
        status: "failed",
        message: `Brain error: ${err.message}`,
      });
    }
  }

  // ==========================================================
  // PHASES
  // ==========================================================
  async _understand(ownerKey, goal, sessionId) {
    // memory context + lightweight Gemini classification
    const recent = this.memory ? this.memory.getRecentMessages(ownerKey, sessionId, 10) : [];
    let classification = { needsFreshData: false, category: "task" };
    if (this.gemini) {
      try {
        const res = await this.gemini.call({
          systemPrompt: "Classify the owner's goal for a personal assistant. Reply JSON only: {\"category\":\"task|question|chat\",\"needsFreshData\":boolean,\"clarificationNeeded\":string|null}. needsFreshData=true only if current outside-world info is required.",
          userPrompt: `Recent context: ${JSON.stringify(recent.slice(-3)).slice(0, 1000)}\nGoal: ${goal}`,
          responseMimeType: "application/json",
        });
        if (res?.ok && res.text) {
          const parsed = JSON.parse(res.text);
          classification = {
            category: parsed.category || "task",
            needsFreshData: !!parsed.needsFreshData,
            clarificationNeeded: parsed.clarificationNeeded || null,
          };
        }
      } catch { /* fallback defaults */ }
    }
    if (classification.clarificationNeeded) {
      return { ok: false, message: classification.clarificationNeeded };
    }
    return { ok: true, ...classification };
  }

  async _plan(ownerKey, goal, understanding, experiences, worldContext) {
    const expBlock = this.learning.formatForPrompt(experiences);
    const worldBlock = worldContext ? this.world.formatForPrompt(worldContext.observations) : "";
    if (!this.gemini) {
      return { ok: false, reason: "no reasoning engine configured" };
    }
    try {
      const res = await this.gemini.call({
        systemPrompt:
          "You are ALEX's planner. Create a plan using ONLY the authorized capabilities listed. " +
          "If no capability fits, reply with {\"feasible\":false,\"reason\":\"...\"}. " +
          "Never invent tools. Reply JSON: {\"feasible\":boolean,\"steps\":[{\"action\":string,\"description\":string,\"parameters\":object}],\"verification\":string}",
        userPrompt:
          `AUTHORIZED CAPABILITIES: file read/write, approved shell commands, git (read), system info, web observation (allowlisted sources), autonomous task steps.\n` +
          (expBlock ? `${expBlock}\n` : "") +
          (worldBlock ? `${worldBlock}\n` : "") +
          `Goal: ${goal}`,
        responseMimeType: "application/json",
      });
      if (!res?.ok || !res.text) return { ok: false, reason: "planner unavailable" };
      const parsed = JSON.parse(res.text);
      if (!parsed.feasible) return { ok: false, reason: parsed.reason };
      return { ok: true, steps: parsed.steps || [], verification: parsed.verification || "" };
    } catch (err) {
      return { ok: false, reason: `planning failed: ${err.message}` };
    }
  }

    async _execute(ownerKey, goal, plan, sessionId, cycleId) {
    try {
      const result =
        await this.tasks.startTask({
          input:
            String(goal || "").trim(),

          ownerId:
            ownerKey,

          sessionId:
            sessionId || "default",

          action:
            "autonomous-task",

          target:
            "project",

          maxRetries:
            5,

          resumeOnRestart:
            true,

          metadata: {
            cycleId,

            verification:
              plan.verification || "",

            brainPlan:
              plan.steps,

            startedBy:
              "AlexBrain",

            keepWorking:
              true,

            untilComplete:
              true,
          },
        });

      const taskId =
        result?.taskId ||
        result?.id ||
        null;

      this.eventBus.emit(
        EVENTS.TASK_CREATED,
        {
          taskId,
          cycleId,
        },
        {
          ownerId:
            ownerKey,

          taskId,

          source:
            "AlexBrain",
        }
      );

      return {
        ok:
          !!taskId,

        taskId,

        result,
      };
    } catch (err) {
      return {
        ok: false,

        error:
          err?.message ||
          String(err),
      };
    }
  }

  _report(cycleId, startedAt, data) {
    return { cycleId, durationMs: Date.now() - startedAt, ...data };
  }
}

// ---------- Singleton ----------
let _instance = null;
function getAlexBrain(opts = {}) {
  if (!_instance) _instance = new AlexBrain(opts);
  return _instance;
}

module.exports = { AlexBrain, getAlexBrain };