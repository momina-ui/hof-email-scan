// 3-check-reply.js — client emails that were never answered.
//
// Rule: an incoming client email with NO outgoing email after it. Overdue after 24h,
// seriously overdue after 48h. Only the OLDEST unanswered email per deal is reported,
// so one silent thread produces one finding rather than five.
const { SETTINGS } = require("./config");

module.exports = function checkReply(d) {
  if (!SETTINGS.CHECK_REPLY_TIME || !d.available.emails) return [];

  const lookback = SETTINGS.REPLY_LOOKBACK_HOURS ? Date.now() - SETTINGS.REPLY_LOOKBACK_HOURS * 3600000 : 0;
  const incoming = d.emails.filter((e) => e.incoming && (!lookback || e.when >= lookback));
  if (!incoming.length) return [];

  const lastOutgoing = Math.max(0, ...d.emails.filter((e) => !e.incoming).map((e) => e.when));

  // unanswered = nothing went out after it
  const unanswered = incoming.filter((e) => e.when > lastOutgoing);
  if (!unanswered.length) return [];

  const oldest = unanswered.reduce((a, b) => (a.when < b.when ? a : b));
  const hours = Math.floor((Date.now() - oldest.when) / 3600000);
  if (hours < SETTINGS.REPLY_DUE_HOURS) return [];               // still within time

  return [{
    type: "noreply",
    severity: hours >= SETTINGS.REPLY_CRITICAL_HOURS ? "high" : "medium",
    hours,
    subject: oldest.subject,
    when: oldest.when,
    count: unanswered.length,
  }];
};
