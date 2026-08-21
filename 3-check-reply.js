// 3-check-reply.js — client emails that were left unanswered AND actually needed an answer.
//
// The first version flagged any incoming email with nothing sent after it, which
// produced a lot of noise: "thank you", "noted", "received", auto-replies and
// document drops do not need a reply at all.
//
// So there are now three gates:
//   1. the deal was touched within REPLY_TOUCH_HOURS (48h by default)
//   2. the oldest unanswered client email is older than REPLY_DUE_HOURS
//   3. reading it, a reply was genuinely REQUIRED — obvious acknowledgements are
//      dropped without spending an AI call, the rest are judged on their content
const { SETTINGS } = require("./config");
const { askJson } = require("./0-ai");

// Obvious "no reply needed" — cheap checks first, no AI spent.
const AUTO = /(out of office|automatic reply|auto-?reply|do not reply|delivery status notification|read receipt|undeliverable|mailer-daemon)/i;
const ACK_ONLY = /^(ok(ay)?|thanks?|thank you( so much| very much)?|noted|received|got it|sure|great|perfect|alright|understood|will do|yes|no problem)[\s.!,]*$/i;

function obviouslyNoReplyNeeded(subject, text) {
  const s = String(subject || ""), t = String(text || "").trim();
  if (AUTO.test(s) || AUTO.test(t.slice(0, 300))) return true;
  const short = t.replace(/\s+/g, " ").trim();
  if (short.length <= 60 && ACK_ONLY.test(short.replace(/[^\w\s.!,]/g, "").trim())) return true;
  if (short.length < 12) return true;                       // nothing to answer
  return false;
}

const PROMPT = (subject, body) => `You review an email a CLIENT sent to an immigration consultancy. Decide whether it REQUIRES a reply from the consultancy.

REPLY REQUIRED (true) when the client:
- asks a question, or asks for an update, a document, a call, or a timeline
- reports a problem, raises a concern, or disputes something
- requests an action, a change, a refund or a cancellation
- sends something that clearly expects confirmation or a decision from us

NO REPLY REQUIRED (false) when the email is:
- a thank you, an acknowledgement, "noted", "received", "ok"
- an automated message, out of office, delivery receipt or newsletter
- simply attaching or forwarding documents we asked for, with no question
- a courtesy or social message with nothing to answer
- a message already fully answered by its own content

Be conservative: if nothing is actually being asked of us, answer false.

Subject: ${String(subject || "").slice(0, 200)}
Body:
"""${String(body || "").slice(0, 2000)}"""

Reply ONLY JSON: {"replyRequired": true|false, "asks": "<what the client is asking for, max 12 words, empty if nothing>"}`;

module.exports = async function checkReply(d) {
  if (!SETTINGS.CHECK_REPLY_TIME || !d.available.emails) return [];

  // gate 1: only files touched recently enough to be in scope for this check
  const touchCut = SETTINGS.REPLY_TOUCH_HOURS ? Date.now() - SETTINGS.REPLY_TOUCH_HOURS * 3600000 : 0;
  if (touchCut && (!d.lastTouched || d.lastTouched < touchCut)) return [];

  const lookback = SETTINGS.REPLY_LOOKBACK_HOURS ? Date.now() - SETTINGS.REPLY_LOOKBACK_HOURS * 3600000 : 0;
  const incoming = d.emails.filter((e) => e.incoming && (!lookback || e.when >= lookback));
  if (!incoming.length) return [];

  const lastOutgoing = Math.max(0, ...d.emails.filter((e) => !e.incoming).map((e) => e.when));
  const unanswered = incoming.filter((e) => e.when > lastOutgoing);
  if (!unanswered.length) return [];

  // gate 2: old enough to be overdue
  const overdue = unanswered.filter((e) => (Date.now() - e.when) / 3600000 >= SETTINGS.REPLY_DUE_HOURS);
  if (!overdue.length) return [];

  // gate 3: was a reply actually required? oldest first, stop at the first real one
  const ordered = overdue.sort((a, b) => a.when - b.when);
  for (const e of ordered) {
    if (obviouslyNoReplyNeeded(e.subject, e.text)) continue;
    const j = await askJson(PROMPT(e.subject, e.text));
    if (!j) continue;                       // no AI budget or a bad response: stay quiet
    if (!j.replyRequired) continue;

    const hours = Math.floor((Date.now() - e.when) / 3600000);
    return [{
      type: "noreply",
      severity: hours >= SETTINGS.REPLY_CRITICAL_HOURS ? "high" : "medium",
      hours, subject: e.subject, when: e.when,
      asks: String(j.asks || "").trim(),
      count: overdue.length,
    }];
  }
  return [];
};
module.exports.obviouslyNoReplyNeeded = obviouslyNoReplyNeeded;
