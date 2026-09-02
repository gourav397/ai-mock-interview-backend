const crypto = require('crypto');

class InterviewSession {
  constructor(userId, jobRole, difficulty, techStack, experience) {
    this.id = crypto.randomUUID();
    this.userId = userId;
    this.jobRole = jobRole;
    this.difficulty = difficulty;
    this.techStack = techStack;
    this.experience = experience;
    this.createdAt = new Date();
    this.startedAt = new Date();
    this.endedAt = null;
    this.isComplete = false;
    this.questionNumber = 0;
    this.messages = [];
    this.topicScores = {};
    this.strongAreas = [];
    this.improvementAreas = [];
    this.averageQuality = 0;
    this.feedback = null;
    this.currentLanguage = 'english';
  }
}

class ContextManager {
  constructor() {
    this.sessions = new Map();
    this.maxHistoryLength = 20;
  }

  createSession(userId, jobRole, difficulty = 'Medium', techStack = '', experience = 'Fresher') {
    const session = new InterviewSession(userId, jobRole, difficulty, techStack, experience);
    this.sessions.set(session.id, session);
    return session;
  }

  getSession(id) { return this.sessions.get(id) || null; }

  addMessage(sessionId, role, text) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.messages.push({ role, text, timestamp: new Date() });
    if (session.messages.length > this.maxHistoryLength) {
      session.messages = session.messages.slice(-this.maxHistoryLength);
    }
  }

  trackTopic(sessionId, topic, quality) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (!session.topicScores[topic]) session.topicScores[topic] = { strong: 0, weak: 0, total: 0 };
    session.topicScores[topic].total++;
    if (quality === 'strong') {
      session.topicScores[topic].strong++;
      if (!session.strongAreas.includes(topic)) session.strongAreas.push(topic);
      session.improvementAreas = session.improvementAreas.filter(t => t !== topic);
    } else {
      session.topicScores[topic].weak++;
      if (!session.improvementAreas.includes(topic)) session.improvementAreas.push(topic);
      session.strongAreas = session.strongAreas.filter(t => t !== topic);
    }
  }

  getContextPrompt(sessionId) {
    const s = this.sessions.get(sessionId);
    if (!s) return { jobRole: 'Unknown', techStack: '', experience: '', difficulty: 'Medium', questionNumber: 0, topicsCovered: '', strongAreas: '', weakAreas: '', averageQuality: 0, recentHistory: '', currentLanguage: 'english' };
    const recent = s.messages.slice(-6).map(m => `${m.role === 'user' ? 'User' : 'Alex'}: ${m.text}`).join('\n');
    const topics = Object.values(s.topicScores);
    if (topics.length > 0) {
      const total = topics.reduce((a, t) => a + t.total, 0);
      const strong = topics.reduce((a, t) => a + t.strong, 0);
      s.averageQuality = total > 0 ? Math.round((strong / total) * 100) : 0;
    }
    return {
      jobRole: s.jobRole, techStack: s.techStack, experience: s.experience, difficulty: s.difficulty,
      questionNumber: s.questionNumber, topicsCovered: Object.keys(s.topicScores).join(', ') || 'None yet',
      strongAreas: s.strongAreas.join(', ') || 'Not yet assessed', weakAreas: s.improvementAreas.join(', ') || 'Not yet assessed',
      averageQuality: s.averageQuality || 0, recentHistory: recent, currentLanguage: s.currentLanguage || 'english',
    };
  }

  getNextDifficulty(sessionId) {
    const s = this.sessions.get(sessionId);
    if (!s) return 'Medium';
    const q = s.averageQuality || 0;
    const n = s.questionNumber || 0;
    if (n < 3) return s.difficulty;
    return q >= 80 ? 'Hard' : q >= 50 ? 'Medium' : 'Easy';
  }

  endSession(sessionId) {
    const s = this.sessions.get(sessionId);
    if (!s || s.isComplete) return null;
    s.isComplete = true;
    s.endedAt = new Date();
    const topics = Object.values(s.topicScores);
    let score = 0;
    if (topics.length > 0) {
      const total = topics.reduce((a, t) => a + t.total, 0);
      const strong = topics.reduce((a, t) => a + t.strong, 0);
      score = total > 0 ? Math.round((strong / total) * 100) : 0;
    }
    const overall = score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : score >= 40 ? 'Average' : 'Needs Improvement';
    const feedback = { overall, score, totalQuestions: s.questionNumber, strongAreas: s.strongAreas, improvementAreas: s.improvementAreas, difficulty: s.difficulty, duration: Math.round((s.endedAt - s.startedAt) / 60000), languageUsed: s.currentLanguage };
    s.feedback = feedback;
    return feedback;
  }
}

module.exports = new ContextManager();