const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

let contextManager;
try { contextManager = require('../utils/interviewContextManager'); console.log('✅ contextManager loaded'); } catch (err) { console.error('❌ contextManager load FAILED:', err.message); contextManager = null; }

const authMiddleware = (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ success: false, message: 'No token provided' });
    req.user = jwt.verify(header.split(' ')[1], 'secretkey');
    next();
  } catch (err) {
    let message = 'Invalid token';
    if (err.name === 'TokenExpiredError') message = 'Token expired. Please login again.';
    return res.status(401).json({ success: false, message });
  }
};

// ─── Gemini Client ───
const API_KEYS = (process.env.GEMINI_API_KEYS || '').split(',').map(k => k.trim()).filter(Boolean);
let rawModel = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
if (rawModel.includes('flash-lite') || rawModel.includes('2.0-flash')) rawModel = 'gemini-3.5-flash';
const MODEL = rawModel;
console.log('[GEMINI] Model:', MODEL, '| Keys:', API_KEYS.length);

let keyIdx = 0, keyCalls = API_KEYS.map(() => 0), keyCooldown = API_KEYS.map(() => 0);

async function callGemini(prompt, timeoutMs = 25000) {
  if (!API_KEYS.length) throw new Error('GEMINI_API_KEYS missing');
  if (prompt.length > 12000) prompt = prompt.slice(0, 12000) + '\n...[trimmed]';

  for (let round = 1; round <= 5; round++) {
    const now = Date.now();
    if (keyCooldown[keyIdx] > now || keyCalls[keyIdx] >= 300) keyIdx = (keyIdx + 1) % API_KEYS.length;
    const key = API_KEYS[keyIdx];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.8, topP: 0.90, maxOutputTokens: 1024 } }),
          signal: controller.signal,
        }
      );
      clearTimeout(timer);
      if (response.ok) {
        keyCalls[keyIdx]++;
        const data = await response.json();
        const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim();
        if (text) return text;
        throw new Error('Empty Gemini response');
      }
      let body = ''; try { body = await response.text(); } catch (e) {}
      if (response.status === 404) {
        try {
          const fb = await fetch(`https://generativelanguage.googleapis.com/v1/models/${MODEL}:generateContent`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.8, topP: 0.90, maxOutputTokens: 1024 } }),
            signal: AbortSignal.timeout(15000),
          });
          if (fb.ok) { keyCalls[keyIdx]++; const d = await fb.json(); const t = d?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim(); if (t) return t; }
        } catch (e) {}
        throw new Error(`404: Model "${MODEL}" not found`);
      }
      if (response.status === 429) { keyCooldown[keyIdx] = Date.now() + 30000; keyIdx = (keyIdx + 1) % API_KEYS.length; await new Promise(r => setTimeout(r, 2000)); continue; }
      if (response.status === 403) throw new Error('403: API key blocked');
      if (response.status >= 500) { await new Promise(r => setTimeout(r, 3000)); continue; }
      throw new Error(`Gemini ${response.status}`);
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') { keyCooldown[keyIdx] = Date.now() + 5000; continue; }
      if (round < 5) { await new Promise(r => setTimeout(r, 1500)); continue; }
      throw err;
    }
  }
  throw new Error('Gemini failed');
}

function cleanText(text) {
  if (!text) return '';
  return text.replace(/^```[\s\S]*?\n/, '').replace(/\n```$/, '').replace(/\*\*(.*?)\*\*/g, '$1').replace(/#{1,6}\s/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

// ─── Language Detection ───
function detectLanguage(text) {
  if (!text || text.trim().length < 2) return 'english';

  // Devanagari = Hindi
  if (/[\u0900-\u097F]/.test(text)) return 'hindi';

  // Roman Hindi / Hinglish keywords
  const hinglishWords = 'hai hoon ho hain nahi na ka ki ke ko se mein main mera meri tere tera aap tum hum kya kyu kyun kaise kese kahan kaha kab kaun acha achha theek thik sahi galat bahut thora thoda zyada chahiye sakta sakte sakti pata batana batao bolo yaar bhai mujhe tujhe usko aaj kal abhi baat kam kaam sath saath kuch sab mast maza namaste ji haan aur lekin magar isliye maine tumne aapne apna apni apne kisi karke sawaal jawab kar karo karta karte karna raha rahe rahi gaya gaye gayi liya liye diya diye kiya kiye aa ja jaa de do le lo aaunga jaaunga hoga hoge hogi waala wala vaala vala dhanyavaad shukriya baitho utho socho taiyar samajh pucho'.split(' ');

  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  let count = 0;
  for (const w of words) { if (hinglishWords.includes(w)) count++; }
  if (words.length > 0 && count / words.length >= 0.25) return 'hinglish';

  return 'english';
}

function getFallback(userMsg, role, tech) {
  const lang = detectLanguage(userMsg || '');
  const topic = tech || role || 'this topic';

  if (lang === 'hindi') {
    const msgs = [
      `बहुत अच्छा! चलिए अब ${topic} से जुड़ा एक और सवाल पूछता हूँ। बताइए, ${topic} में आपकी सबसे बड़ी ताकत क्या है?`,
      `शानदार! चलिए अगले सवाल पर चलते हैं। आपको ${topic} में सबसे ज्यादा क्या पसंद है?`,
      `बहुत बढ़िया! आपके हिसाब से ${topic} में सफलता के लिए सबसे ज़रूरी चीज़ क्या है?`,
    ];
    return msgs[Math.floor(Math.random() * msgs.length)];
  }
  if (lang === 'hinglish') {
    const msgs = [
      `Bahut accha! Chaliye ab ${topic} se juda ek aur sawaal poochta hoon. Bataaiye, ${topic} mein aapki sabse badi taakat kya hai?`,
      `Shaandaar! Aapko ${topic} mein sabse zyada kya pasand hai?`,
      `Bahut badhiya! Aapke hisaab se ${topic} mein safal hone ke liye sabse zaroori cheez kya hai?`,
    ];
    return msgs[Math.floor(Math.random() * msgs.length)];
  }
  const msgs = [
    `Great! Let me ask you about ${topic}. What's your biggest strength in this area?`,
    `Excellent! What do you enjoy most about ${topic}?`,
    `Wonderful! What's the most important skill for success in ${topic}?`,
  ];
  return msgs[Math.floor(Math.random() * msgs.length)];
}

// ─── Routes ───

router.get('/voice/test', (req, res) => {
  res.json({ success: true, message: '✅ Voice router working', contextManagerLoaded: !!contextManager, model: MODEL });
});

router.post('/voice/start', authMiddleware, async (req, res) => {
  try {
    const { jobRole, difficulty = 'Medium', techStack = '', experience = 'Fresher' } = req.body;
    if (!jobRole?.trim()) return res.status(400).json({ success: false, message: 'Job role required' });
    if (!contextManager) return res.status(500).json({ success: false, message: 'Context manager not loaded' });

    const userId = req.user._id?.toString() || req.user.id?.toString() || 'anonymous';
    const session = contextManager.createSession(userId, jobRole, difficulty, techStack, experience);

    const prompt = `You are Alex, a warm, friendly voice interview coach. Start a new interview.

Rules: 2-3 sentences. Greet warmly. Ask an ice-breaker question. Be natural, not robotic.

Job Role: ${jobRole}
Tech Stack: ${techStack || 'general'}
Experience: ${experience}

Respond in English (you'll match the user's language after they speak):`;

    let response;
    try { response = await callGemini(prompt, 20000); } catch (e) {
      response = `Hi there! I'm Alex, your interview coach. Welcome to your ${difficulty} level interview for ${jobRole}. Tell me a bit about yourself — what got you into ${techStack || jobRole}?`;
    }

    const cleanResp = cleanText(response);
    if (contextManager.addMessage) contextManager.addMessage(session.id, 'assistant', cleanResp);
    res.json({ success: true, sessionId: session.id, message: cleanResp, context: { jobRole, difficulty, techStack, experience } });
  } catch (error) {
    console.error('❌ Start error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/voice/chat', authMiddleware, async (req, res) => {
  try {
    const { sessionId, message, emotion, isFinal } = req.body;
    if (!sessionId) return res.status(400).json({ success: false, message: 'Session ID required' });
    if (!contextManager) return res.status(500).json({ success: false, message: 'Context manager not loaded' });
    const session = contextManager.getSession(sessionId);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });

    if (message && !isFinal) return res.json({ success: true, type: 'interim' });

    // ─── DETECT LANGUAGE ───
    const userLang = detectLanguage(message || '');
    console.log(`[LANG] "${(message||'').slice(0,40)}" → ${userLang}`);

    // Store language in session
    if (userLang !== 'english') session.currentLanguage = userLang;

    if (message?.trim()) {
      contextManager.addMessage(sessionId, 'user', message);
      session.questionNumber++;
    }

    // Check wrap-up
    if (session.questionNumber >= 8 && (session.questionNumber >= 10 || isWrapUp(message))) {
      const fb = contextManager.endSession(sessionId);
      const lang = session.currentLanguage || 'english';
      let fbText;
      if (lang === 'hindi') fbText = `बहुत बढ़िया! आपने ${fb.totalQuestions} सवालों के जवाब दिए। परफॉर्मेंस: ${fb.overall}. अभ्यास करते रहिए! शुभकामनाएँ!`;
      else if (lang === 'hinglish') fbText = `Bahut badhiya! Aapne ${fb.totalQuestions} sawaalon ke jawab diye. Performance: ${fb.overall}. Abhyaas karte rahiye! Shubhkaamnayein!`;
      else fbText = `Great job! You answered ${fb.totalQuestions} questions. Overall performance: ${fb.overall}. Keep practicing! Best of luck!`;

      contextManager.addMessage(sessionId, 'assistant', fbText);
      return res.json({ success: true, type: 'feedback', message: fbText, feedback: fb, sessionComplete: true, sessionId });
    }

    // ─── BUILD LANGUAGE-FORCED PROMPT ───
    session.difficulty = contextManager.getNextDifficulty(sessionId);
    const ctx = contextManager.getContextPrompt(sessionId);
    const targetLang = session.currentLanguage || 'english';

    let langInstruction;
    if (targetLang === 'hindi') {
      langInstruction = `⚠️⚠️⚠️ CRITICAL INSTRUCTION — THE USER IS SPEAKING HINDI.

YOU MUST respond ENTIRELY in Hindi (Devanagari script like मैं, हूँ, नहीं, है, का, की, के, सकता, चाहिए, बहुत, अच्छा).

DO NOT write in English. DO NOT write in Roman script. Write ONLY in Hindi Devanagari. This is ABSOLUTELY MANDATORY.

Example of correct response: "बहुत अच्छा! आपने अच्छा जवाब दिया। चलिए अब आपको एक और सवाल पूछता हूँ। बताइए, आपको इस फील्ड में सबसे ज्यादा क्या पसंद है?"`;

    } else if (targetLang === 'hinglish') {
      langInstruction = `⚠️⚠️⚠️ CRITICAL INSTRUCTION — THE USER IS SPEAKING HINGLISH (Roman Hindi).

YOU MUST respond in natural Hinglish using words like: "hai", "hoon", "nahi", "ka", "ki", "ke", "ko", "acha", "bahut", "chahiye", "sakta", "kya", "kaise", "yaar", "baat", "kar", "ho", "ja" mixed naturally with English.

DO NOT use pure English sentences. DO NOT use Devanagari Hindi script. Use Roman script only.

Example of correct response: "Bahut accha! Aapne achha jawab diya. Chaliye ab aapko ek aur sawaal poochta hoon. Bataaiye, aapko is field mein sabse zyada kya pasand hai?"`;

    } else {
      langInstruction = 'Respond in natural English.';
    }

    let emotionHint = '';
    if (emotion) {
      const map = { happy: 'Confident', surprised: 'Curious', fearful: 'Nervous, needs encouragement', sad: 'Low confidence, encourage', angry: 'Frustrated, calm down', disgusted: 'Displeased', neutral: 'Calm' };
      emotionHint = `\nUser's mood: ${map[emotion] || emotion}. Adapt tone.\n`;
    }

    const prompt = `You are Alex, a friendly real-time voice interview coach.

${langInstruction}
${emotionHint}

## RULES
- 2-4 sentences only (voice interview = short)
- Acknowledge what the user said specifically
- Ask ONE follow-up question
- Never repeat the same question
- Be encouraging, supportive
- NEVER be romantic or flirtatious

## CONTEXT
- Role: ${ctx.jobRole}
- Tech: ${ctx.techStack}
- Experience: ${ctx.experience}
- Difficulty: ${ctx.difficulty}
- Question #${ctx.questionNumber}

## RECENT
${ctx.recentHistory || ''}

## USER SAID: "${message || ''}"

## RESPOND NOW in ${targetLang === 'hindi' ? 'HINDI (Devanagari script ONLY)' : targetLang === 'hinglish' ? 'HINGLISH (Roman Hindi+English mix)' : 'ENGLISH'}.
### Write your response BELOW (no extra text, no markdown):`;

    let responseText;
    try {
      responseText = await callGemini(prompt, 25000);
    } catch (err) {
      console.error('[GEMINI] Chat error:', err.message);
      responseText = getFallback(message, session.jobRole, session.techStack);
    }

    const cleanResp = cleanText(responseText);
    contextManager.addMessage(sessionId, 'assistant', cleanResp);
    console.log('[VOICE] Alex:', cleanResp.slice(0, 100));

    res.json({ success: true, type: 'response', message: cleanResp, questionNumber: session.questionNumber, difficulty: session.difficulty, sessionComplete: false });
  } catch (error) {
    console.error('❌ Chat error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/voice/session/:sessionId', authMiddleware, async (req, res) => {
  try {
    const { sessionId } = req.params;
    if (!contextManager) return res.status(500).json({ success: false, message: 'Context manager not loaded' });
    const session = contextManager.getSession(sessionId);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });
    res.json({ success: true, session: { id: session.id, jobRole: session.jobRole, techStack: session.techStack, questionNumber: session.questionNumber, isComplete: session.isComplete, currentLanguage: session.currentLanguage } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/voice/end', authMiddleware, async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ success: false, message: 'Session ID required' });
    if (!contextManager) return res.status(500).json({ success: false, message: 'Context manager not loaded' });
    const feedback = contextManager.endSession(sessionId);
    if (!feedback) return res.status(404).json({ success: false, message: 'Session not found' });
    res.json({ success: true, feedback, sessionId });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

function isWrapUp(msg) {
  if (!msg) return false;
  const m = msg.toLowerCase().trim();
  return ['that\'s all', 'i\'m done', 'finished', 'no more', 'i am done', 'that is all', 'bas', 'bas yahi', 'ho gaya', 'khatam'].some(p => m.includes(p));
}

module.exports = router;