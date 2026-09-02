// ============================================================
// ALEX Decision Engine — Structured, validated AI decisions
// ============================================================

const { callGemini } = require("./utils/gemini");
const config = require("./config");

class DecisionEngine {
  constructor() {
    this.ready = config.ai.available;
    if (!this.ready) console.warn("🧠 ALEX DecisionEngine: AI unavailable — limited mode");
  }

  async decide(context, options = {}) {
    if (!this.ready) return this._fallbackDecision(context);
    const { temperature = 0.3, timeoutMs = 15000 } = options;

    try {
      const prompt = `You are ALEX's DECISION ENGINE.
Context: ${JSON.stringify(context, null, 2).slice(0, 3000)}

Rules: Be conservative. Prefer safety. If uncertain, escalate.
Respond in JSON only:
{"decision":"approve|reject|escalate|investigate","confidence":0.0-1.0,"reason":"detailed reasoning","riskLevel":0-4,"requiresHuman":boolean,"suggestedAction":"next step","validationRequired":["checks"]}`;

      const result = await callGemini(prompt, { temperature, timeoutMs });
      if (!result.decision || !result.reason) return this._fallbackDecision(context, "Malformed response");
      return { aiPowered: true, ...result };
    } catch (err) {
      console.log("🧠 DecisionEngine AI failed:", err.message);
      return this._fallbackDecision(context, err.message);
    }
  }

  async classify(event) {
    if (!this.ready) return { severity: event.severity || "MEDIUM", category: event.category || "unknown", action: "investigate" };
    try {
      const prompt = `Classify this event:\n${JSON.stringify(event, null, 2).slice(0, 1500)}\nRespond in JSON:\n{"severity":"LOW|MEDIUM|HIGH|CRITICAL","category":"error|warning|security|performance|info","requiresImmediateAction":boolean,"suggestedAction":"string"}`;
      return await callGemini(prompt, { temperature: 0.1 });
    } catch { return { severity: event.severity || "MEDIUM", category: event.category || "unknown", action: "investigate" }; }
  }

  async reviewCodeChange(changeProposal) {
    if (!this.ready) return { safe: (changeProposal.riskLevel || 1) <= 2, reason: "AI unavailable — using threshold" };
    try {
      const prompt = `Review this code change for safety:\n${JSON.stringify(changeProposal, null, 2).slice(0, 2000)}\nCheck: Does it expose secrets? Bypass auth? Risk data loss? Introduce vulns? Reversible?\nRespond: {"safe":boolean,"riskLevel":0-4,"concerns":[],"approveAutomatically":boolean,"requiresHumanReview":boolean,"reason":"string"}`;
      return await callGemini(prompt, { temperature: 0.1 });
    } catch { return { safe: (changeProposal.riskLevel || 1) <= 2, reason: "AI review failed — using threshold" }; }
  }

  _fallbackDecision(context, reason = "AI unavailable") {
    const severity = context.severity || "MEDIUM";
    const riskLevel = severity === "CRITICAL" ? 4 : severity === "HIGH" ? 3 : severity === "MEDIUM" ? 2 : 1;
    return { aiPowered: false, decision: riskLevel > 2 ? "escalate" : "investigate", confidence: 0.5, reason: `${reason}. Rule-based fallback. Risk: ${riskLevel}`, riskLevel, requiresHuman: riskLevel > 2, suggestedAction: riskLevel > 2 ? "Escalate to human" : "Investigate safely", validationRequired: ["log_review", "health_check"] };
  }
}

let instance = null;
function getDecisionEngine() {
  if (!instance) instance = new DecisionEngine();
  return instance;
}

module.exports = { DecisionEngine, getDecisionEngine };