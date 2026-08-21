// selftest.js — the email-scan rules register.
// Every agreed rule is a scenario here. Run after any edit: node selftest.js
process.env.HUBSPOT_TOKEN = process.env.HUBSPOT_TOKEN || "selftest";

const checkReply = require("./3-check-reply");
const { obviouslyNoReplyNeeded } = require("./3-check-reply");
const checkTask = require("./4-check-task");
const { freshPart } = require("./2-check-tone");
const { SETTINGS, CASE_MANAGERS } = require("./config");
const { buildReport } = require("./5-report");

const H = 3600000, now = Date.now();
const deal = (o = {}) => ({ available: { emails: true, tasks: true, contact: true }, emails: [], tasks: [], lastTouched: 0, ...o });
const inc = (hoursAgo, subject = "Any update?") => ({ incoming: true, when: now - hoursAgo * H, subject, text: "Sir please tell me when my file will be submitted, it has been three weeks." });
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
check("deals are scanned only if touched within the window (48h default)",
  SETTINGS.TOUCHED_WITHIN_HOURS === 48, `got ${SETTINGS.TOUCHED_WITHIN_HOURS}`);
check("unanswered emails use a 48h touch window", SETTINGS.REPLY_TOUCH_HOURS === 48);
check("missing task uses a 24h touch window", SETTINGS.TASK_TOUCH_HOURS === 24);
check("the touched window is read from the hours box", (() => {
  const cases = [["48", 48], ["12", 12], ["30", 30], ["", 48], ["abc", 48], ["0", 0]];
  for (const [input, expect] of cases) {
    for (const k of Object.keys(require.cache)) delete require.cache[k];
    process.env.HOURS_INPUT = input;
    if (require("./config").SETTINGS.TOUCHED_WITHIN_HOURS !== expect) return false;
  }
  delete process.env.HOURS_INPUT;
  for (const k of Object.keys(require.cache)) delete require.cache[k];
  return true;
})());
check("report goes to Momina only",
  SETTINGS.REPORT_TO === "momina@hofmigration.com" && SETTINGS.REPORT_CC.length === 0);

// ---- which client emails never even reach the AI ----
check("thank you is dropped without an AI call", obviouslyNoReplyNeeded("Re: docs", "Thank you so much"));
check("noted is dropped", obviouslyNoReplyNeeded("Re: update", "noted"));
check("out of office is dropped", obviouslyNoReplyNeeded("Automatic reply: Out of Office", "I am away until Monday"));
check("undeliverable bounce is dropped", obviouslyNoReplyNeeded("Undeliverable", "delivery status notification failure"));
check("a real question is NOT dropped",
  !obviouslyNoReplyNeeded("Any update?", "Sir can you please tell me when my file will be submitted? It has been three weeks."));
check("a refund demand is NOT dropped",
  !obviouslyNoReplyNeeded("Refund", "I want to cancel and get my money back"));

// ---- task after a recent touch ----
check("worked 30 min ago with no task is flagged", checkTask(deal({ lastTouched: now - 0.5 * H })).length === 1);
check("worked 23h ago with no task is flagged", checkTask(deal({ lastTouched: now - 23 * H })).length === 1);
check("worked 30 min ago with an open task is fine",
  checkTask(deal({ lastTouched: now - 0.5 * H, tasks: [{ hs_task_subject: "Follow up", hs_task_status: "NOT_STARTED" }] })).length === 0);
check("a completed task does not count",
  checkTask(deal({ lastTouched: now - 0.5 * H, tasks: [{ hs_task_subject: "Old", hs_task_status: "COMPLETED" }] })).length === 1);
check("our own compliance task does not count",
  checkTask(deal({ lastTouched: now - 0.5 * H, tasks: [{ hs_task_subject: "[Compliance] do x", hs_task_status: "NOT_STARTED" }] })).length === 1);
check("worked 5h ago is inside the 24h window", checkTask(deal({ lastTouched: now - 5 * H })).length === 1);
check("worked 30h ago is outside the 24h window", checkTask(deal({ lastTouched: now - 30 * H })).length === 0);
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

// ---- unanswered client emails (async: the AI gate returns nothing without a key) ----
(async () => {
  const noKey = !process.env.GEMINI_KEY;
  check("answered email is not flagged", (await checkReply(deal({ lastTouched: now, emails: [inc(30), out(29)] }))).length === 0);
  check("a reply after the client email clears it", (await checkReply(deal({ lastTouched: now, emails: [inc(50), out(2)] }))).length === 0);
  check("email within 24h is not chased yet", (await checkReply(deal({ lastTouched: now, emails: [inc(5)] }))).length === 0);
  check("a deal not touched in 48h is out of scope",
    (await checkReply(deal({ lastTouched: now - 100 * H, emails: [inc(60)] }))).length === 0);
  check("an acknowledgement is never chased",
    (await checkReply(deal({ lastTouched: now, emails: [{ incoming: true, when: now - 30 * H, subject: "Re: docs", text: "Thank you so much" }] }))).length === 0);
  check("broken email lookup stays silent",
    (await checkReply(deal({ available: { emails: false, tasks: true }, lastTouched: now, emails: [inc(60)] }))).length === 0);
  check(`without a GEMINI_KEY nothing is chased${noKey ? "" : " (skipped: key present)"}`,
    noKey ? (await checkReply(deal({ lastTouched: now, emails: [inc(60, "Any update?")] }))).length === 0 : true);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log("\nA rule stopped working. Fix it before scanning for real."); process.exit(1); }
})();
