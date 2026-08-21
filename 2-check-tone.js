// 2-check-tone.js — flags only the emails that genuinely need a human eye.
//
// DELIBERATELY NARROW. Early runs flagged ordinary chasing and mild impatience,
// which buries the real problems. The bar now is: would a manager reading this
// stop and step in? If not, it is not a flag.
//
// INCOMING (client): explicit anger, explicit rudeness/insult, an actual REFUND
// demand, or explicit strong disappointment in HOF.
// OUTGOING (us): genuinely rude, sarcastic, dismissive or aggressive wording.
//
// Only email text is read; attachments and images are invisible. Quoted history is
// trimmed so an old angry line does not re-flag on every reply in the thread.
const { SETTINGS } = require("./config");
const { askJson, usage } = require("./0-ai");

function freshPart(text) {
  let t = String(text || "");
  const cuts = [/On .{0,60}wrote:/i, /-----Original Message-----/i, /From:.{0,80}Sent:/i, /_{10,}/];
  for (const c of cuts) { const m = t.match(c); if (m && m.index > 40) t = t.slice(0, m.index); }
  return t.split(/\n/).filter((l) => !/^\s*>/.test(l)).join("\n").trim();
}

const INCOMING_PROMPT = (subject, body) => `You review an email a CLIENT sent to an immigration consultancy. Flag it ONLY if it clearly needs a manager to step in today.

FLAG only when one of these is unmistakable:
- ANGRY: the client is plainly angry — shouting, ALL CAPS anger, insults, threats to complain, threats of legal action or a bad review.
- RUDE: the client is insulting or abusive toward staff.
- REFUND: the client actually asks for their money back, or to cancel and be refunded.
- DISAPPOINTED: the client states clear, strong dissatisfaction with HOF's service — for example "very poor service", "extremely disappointed", "worst experience", "you have wasted my time".

DO NOT FLAG any of these, they are normal business email:
- asking for an update, however many times, even "any update?" or "still waiting"
- mild impatience, urgency, or worry about timelines
- questions, requests for documents, or chasing a reply
- frustration aimed at the embassy, the government, IRCC, USCIS or a delay outside HOF
- neutral or factual complaints without strong emotional language
- bad news, cancellations for personal reasons, or a client saying they cannot continue
- anything you are unsure about

Be conservative. If it is borderline, answer false.

Subject: ${String(subject || "").slice(0, 200)}
Body:
"""${String(body || "").slice(0, 2500)}"""

Reply ONLY JSON: {"flag": true|false, "category": "angry"|"rude"|"refund"|"disappointed"|"", "confidence": "high"|"low", "quote": "<the exact words that prove it, max 15 words>"}`;

const OUTGOING_PROMPT = (subject, body) => `You review an email OUR OWN STAFF sent to a client. Flag it ONLY if the wording is genuinely unprofessional toward the client.

FLAG only when unmistakable:
- RUDE or insulting wording, sarcasm, or talking down to the client
- DISMISSIVE: blaming or scolding the client, e.g. "I already told you", "you never read my emails"
- AGGRESSIVE or threatening tone

DO NOT FLAG:
- short, blunt or businesslike replies
- firm chasing for documents or payment, stated politely
- delivering bad news, refusals or deadlines politely
- imperfect English, typos, or missing pleasantries
- templates and standard process emails
- anything borderline

Be conservative. If it is borderline, answer false.

Subject: ${String(subject || "").slice(0, 200)}
Body:
"""${String(body || "").slice(0, 2500)}"""

Reply ONLY JSON: {"flag": true|false, "category": "rude"|"dismissive"|"aggressive"|"", "confidence": "high"|"low", "quote": "<the exact words that prove it, max 15 words>"}`;

module.exports = async function checkTone(d, windowStart) {
  if (!d.available.emails) return [];
  const findings = [];
  const recent = d.emails.filter((e) => !windowStart || e.when >= windowStart).slice(0, SETTINGS.MAX_EMAILS_PER_DEAL);

  for (const e of recent) {
    const body = freshPart(e.text);
    if (body.replace(/\s+/g, "").length < 25) continue;

    const incoming = e.incoming;
    if (incoming && !SETTINGS.CHECK_INCOMING_TONE) continue;
    if (!incoming && !SETTINGS.CHECK_OUTGOING_TONE) continue;

    const j = await askJson(incoming ? INCOMING_PROMPT(e.subject, body) : OUTGOING_PROMPT(e.subject, body));
    if (!j || !j.flag) continue;
    // only act on confident findings, and only when it can point at the actual words
    if (String(j.confidence || "").toLowerCase() !== "high") continue;
    if (!String(j.quote || "").trim()) continue;

    findings.push({
      type: incoming ? "client" : "staff",
      category: j.category || (incoming ? "concern" : "tone"),
      severity: incoming && /refund|angry/i.test(j.category || "") ? "high" : incoming ? "medium" : "high",
      subject: e.subject, when: e.when, quote: j.quote,
    });
  }
  return findings;
};
module.exports.freshPart = freshPart;
module.exports.aiUsage = usage;
