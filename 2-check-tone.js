// 2-check-tone.js — reads the emails and flags the ones that need a human eye.
//
// INCOMING (from the client): angry, rude, asking for a refund, or disappointed.
// OUTGOING (from us): angry, rude or unprofessional toward the client.
//
// Only text is read — attachments and images are invisible. Quoted history is
// trimmed so an old angry line in a reply chain is not counted again and again.
const { SETTINGS } = require("./config");

let aiCalls = 0;
const budgetLeft = () => aiCalls < SETTINGS.MAX_AI_CALLS;

// cut quoted history: "On ... wrote:", ">" lines, common separators
function freshPart(text) {
  let t = String(text || "");
  const cuts = [/On .{0,60}wrote:/i, /-----Original Message-----/i, /From:.{0,80}Sent:/i, /_{10,}/];
  for (const c of cuts) { const m = t.match(c); if (m && m.index > 40) t = t.slice(0, m.index); }
  return t.split(/\n/).filter((l) => !/^\s*>/.test(l)).join("\n").trim();
}

async function judge(kind, subject, body) {
  if (!process.env.GEMINI_KEY || !budgetLeft()) return null;
  aiCalls++;
  const prompt = kind === "incoming"
    ? `You review emails a client sent to an immigration consultancy. Decide if THIS client email shows any of: anger, rudeness, a REFUND request, or clear disappointment/frustration.

Be strict. A normal question, a chase for an update, or a neutral complaint about timelines is NOT a flag. Flag only genuine anger, rudeness, a refund demand, or clear disappointment.

Subject: ${String(subject || "").slice(0, 200)}
Body:
"""${String(body || "").slice(0, 2500)}"""

Reply ONLY JSON: {"flag": true|false, "category": "angry"|"rude"|"refund"|"disappointed"|"", "severity": "high"|"medium", "quote": "<max 15 words from the client>"}`
    : `You review emails our consultancy staff sent to a client. Decide if THIS email is angry, rude, dismissive or unprofessional toward the client.

Be strict. Being firm, brief, or delivering bad news politely is NOT a flag. Flag only genuinely rude, sarcastic, dismissive or aggressive wording.

Subject: ${String(subject || "").slice(0, 200)}
Body:
"""${String(body || "").slice(0, 2500)}"""

Reply ONLY JSON: {"flag": true|false, "category": "angry"|"rude"|"unprofessional"|"", "severity": "high"|"medium", "quote": "<max 15 words from the email>"}`;

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${SETTINGS.GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_KEY}`,
      { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0 } }) });
    const t = (await res.json())?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const m = t.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const j = JSON.parse(m[0]);
    return j.flag ? j : null;
  } catch { return null; }
}

module.exports = async function checkTone(d, windowStart) {
  if (!d.available.emails) return [];
  const findings = [];
  const recent = d.emails.filter((e) => !windowStart || e.when >= windowStart).slice(0, SETTINGS.MAX_EMAILS_PER_DEAL);

  for (const e of recent) {
    const body = freshPart(e.text);
    if (body.replace(/\s+/g, "").length < 25) continue;          // nothing readable

    if (e.incoming && SETTINGS.CHECK_INCOMING_TONE) {
      const j = await judge("incoming", e.subject, body);
      if (j) findings.push({
        type: "client", category: j.category || "concern", severity: j.severity || "medium",
        subject: e.subject, when: e.when, quote: j.quote || "",
      });
    } else if (!e.incoming && SETTINGS.CHECK_OUTGOING_TONE) {
      const j = await judge("outgoing", e.subject, body);
      if (j) findings.push({
        type: "staff", category: j.category || "tone", severity: j.severity || "medium",
        subject: e.subject, when: e.when, quote: j.quote || "",
      });
    }
  }
  return findings;
};
module.exports.freshPart = freshPart;
module.exports.aiUsage = () => aiCalls;
