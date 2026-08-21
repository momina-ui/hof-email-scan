// selftest.js — the email-scan rules register.
// Every agreed rule is a scenario here. Run after any edit: node selftest.js
process.env.HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN || "selftest";

const checkReply = require("./3-check-reply");
const checkTask = require("./4-check-task");
const { freshPart } = require("./2-check-tone");
const { SETTINGS, CASE_MANAGERS } = require("./config");
const { buildReport } = require("./5-report");

const H = 3600000, now = Date.now();
const deal = (o = {}) => ({ available: { emails: true, tasks: true, contact: true }, emails: [], tasks: [], lastTouched: 0, ...o });
const inc = (hoursAgo, subject = "Any update?") => ({ incoming: true, when: now - hoursAgo * H, subject, text: "hello" });
const out = (hoursAgo, subject = "Re: update") => ({ incoming: false, when: now - hoursAgo * H, subject, text: "hello" });

let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `\n        ${detail}`}`);
  ok ? pass++ : fail++;
};

console.log("EMAIL SCAN RULES SELF-TEST\n");

// ---- config ----
check("all 12 case managers are configured", CASE_MANAGERS.length === 12, `got ${CASE_MANAGERS.length}`);
check("only Active clients are scanned", SETTINGS.CLIENT_STATUS_ALLOWED.join() === "Active");
check("both In Progress and In Process are accepted",
  SETTINGS.APPLICATION_STATUS_ALLOWED.includes("In Progress") && SETTINGS.APPLICATION_STATUS_ALLOWED.includes("In Process"));
check("report goes to Momina only",
  SETTINGS.REPORT_TO === "momina@hofmigration.com" && SETTINGS.REPORT_CC.length === 0);

// ---- unanswered client emails ----
check("answered email is not flagged", checkReply(deal({ emails: [inc(30), out(29)] })).length === 0);
check("unanswered 30h is flagged as medium", (checkReply(deal({ emails: [inc(30)] }))[0] || {}).severity === "medium");
check("unanswered 60h is flagged as high", (checkReply(deal({ emails: [inc(60)] }))[0] || {}).severity === "high");
check("unanswered 5h is not flagged yet", checkReply(deal({ emails: [inc(5)] })).length === 0);
check("a reply after the client email clears it", checkReply(deal({ emails: [inc(50), out(2)] })).length === 0);
check("only the oldest unanswered email is reported",
  checkReply(deal({ emails: [inc(50, "first"), inc(30, "second")] })).length === 1);
check("the oldest unanswered email drives the age",
  (checkReply(deal({ emails: [inc(50, "first"), inc(30, "second")] }))[0] || {}).hours >= 49);
check("unanswered count is reported",
  (checkReply(deal({ emails: [inc(50), inc(30)] }))[0] || {}).count === 2);
check("broken email lookup stays silent",
  checkReply(deal({ available: { emails: false, tasks: true }, emails: [inc(60)] })).length === 0);

// ---- task after a recent touch ----
check("worked 30 min ago with no task is flagged", checkTask(deal({ lastTouched: now - 0.5 * H })).length === 1);
check("worked 30 min ago with an open task is fine",
  checkTask(deal({ lastTouched: now - 0.5 * H, tasks: [{ hs_task_subject: "Follow up", hs_task_status: "NOT_STARTED" }] })).length === 0);
check("a completed task does not count",
  checkTask(deal({ lastTouched: now - 0.5 * H, tasks: [{ hs_task_subject: "Old", hs_task_status: "COMPLETED" }] })).length === 1);
check("our own compliance task does not count",
  checkTask(deal({ lastTouched: now - 0.5 * H, tasks: [{ hs_task_subject: "[Compliance] do x", hs_task_status: "NOT_STARTED" }] })).length === 1);
check("worked 5h ago is outside the 2h window", checkTask(deal({ lastTouched: now - 5 * H })).length === 0);
check("never touched is not flagged", checkTask(deal({ lastTouched: 0 })).length === 0);
check("broken task lookup stays silent",
  checkTask(deal({ available: { emails: true, tasks: false }, lastTouched: now - 0.5 * H })).length === 0);

// ---- quoted history is trimmed before the AI reads it ----
const quoted = `This is unacceptable, I want my refund.\n\nOn Mon, 3 Aug 2026 at 10:00, Warda wrote:\n> Dear sir, your file is progressing well and everything is fine`;
check("quoted history is cut from the email body",
  /refund/i.test(freshPart(quoted)) && !/progressing well/i.test(freshPart(quoted)), freshPart(quoted));
check("plain email survives trimming", freshPart("I am very disappointed with the delay").includes("disappointed"));

// ---- the report renders ----
const html = buildReport({
  clientTone: [{ manager: "Warda Badar", dealId: "1", dealName: "Ahmed Khan", severity: "high", category: "refund", subject: "Refund", when: now, quote: "I want my money back" }],
  staffTone: [{ manager: "Anwar Saeed", dealId: "2", dealName: "Sara Ali", severity: "high", category: "rude", subject: "Re: docs", when: now, quote: "you never read anything" }],
  noReply: [{ manager: "Brenda Murowanidzwa", dealId: "3", dealName: "Omar F", severity: "high", hours: 61, subject: "Any update?", when: now - 61 * H, count: 2 }],
  noTask: [{ manager: "Yamina Sadi", dealId: "4", dealName: "Lina M", minutesAgo: 35, hadCompleted: true }],
  scanned: 120, cmCount: 12, windowLabel: "last 24 hour(s)", dryRun: true,
});
check("report contains all four sections",
  /Client emails needing attention/.test(html) && /Our emails flagged for tone/.test(html)
  && /not answered in time/.test(html) && /no task set/.test(html));
check("report links to the deal", html.includes("/record/0-3/1"));
check("report escapes quoted client text", !/<script/i.test(html));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log("\nA rule stopped working. Fix it before scanning for real."); process.exit(1); }
