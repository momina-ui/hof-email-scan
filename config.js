// config.js — settings for the HOF Email Scanning agent (case managers).
// SAFE TO EDIT: the CASE_MANAGERS list and anything in SETTINGS.

// Case managers this compliance covers. Owner IDs are resolved from HubSpot at run
// time, so you only ever need the email address here.
const CASE_MANAGERS = [
  "thushara@hofmigration.com",
  "tamjeed@hofmigration.com",
  "anwar@hofmigration.com",
  "maryamchand@hofmigration.com",
  "rahima@hofmigration.com",
  "hashimtahir@hofmigration.com",
  "alitariq@hofmigration.com",
  "warda@hofmigration.com",
  "brenda@hofmigration.com",
  "umer@hofmigration.com",
  "yamina@hofmigration.com",
  "muhammadzaryab@hofmigration.com",
];

const SETTINGS = {
  // true = safe test: scans and prints, sends no report. Set false to send.
  DRY_RUN: process.env.DRY_RUN_INPUT ? process.env.DRY_RUN_INPUT === "true" : true,

  // ---- who gets the report ----
  REPORT_TO: "momina@hofmigration.com",
  REPORT_CC: [],                       // nobody else; add addresses here if needed

  // Sent through Resend. IMPORTANT: with the built-in test sender
  // "onboarding@resend.dev", Resend only delivers to the address the Resend account
  // itself was registered with. So register Resend with momina@hofmigration.com and
  // this works immediately, with no DNS or domain verification.
  // Later, if hofmigration.com is verified in Resend, switch FROM_EMAIL to
  // noreply@hofmigration.com and the report can go to anyone.
  FROM_EMAIL: process.env.FROM_EMAIL || "onboarding@resend.dev",

  // ---- what counts as a deal worth scanning ----
  // Only Active clients whose application is still moving. Everything else is skipped.
  CLIENT_STATUS_ALLOWED: ["Active"],
  // NOTE: the portal has BOTH "In Progress" and "In Process" as separate values,
  // so both are accepted or half the deals would be missed.
  APPLICATION_STATUS_ALLOWED: ["In Progress", "In Process"],

  // ---- windows ----
  // How many HOURS back to scan emails for tone. Type any number in the workflow.
  SCAN_HOURS: (() => {
    const raw = String(process.env.HOURS_INPUT ?? "24").trim().toLowerCase();
    if (!raw) return 24;
    if (raw === "any" || raw === "0") return 0;
    const n = parseFloat(raw.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : 24;
  })(),
  SCAN_HOURS_RAW: String(process.env.HOURS_INPUT ?? "24").trim(),

  // How far back to look for client emails that were never replied to.
  REPLY_LOOKBACK_HOURS: 168,      // 7 days
  REPLY_DUE_HOURS: 24,            // overdue after this
  REPLY_CRITICAL_HOURS: 48,       // seriously overdue after this

  // A deal touched in the last N hours with no open task on it.
  TASK_TOUCH_HOURS: 2,

  // ---- limits ----
  MAX_DEALS: (() => { const r = (process.env.LIMIT_INPUT || "all").toLowerCase(); if (!r || r === "all" || r === "0") return 0; const n = parseInt(r, 10); return n > 0 ? n : 0; })(),
  MAX_EMAILS_PER_DEAL: 8,         // newest first, keeps the AI cost sane
  MAX_AI_CALLS: 400,              // hard ceiling per run

  PORTAL_ID: "23735726",
  TZ_OFFSET_HOURS: 5,
  GEMINI_MODEL: "gemini-flash-lite-latest",

  // ---- toggles ----
  CHECK_INCOMING_TONE: true,      // client angry / rude / refund / disappointed
  CHECK_OUTGOING_TONE: true,      // our own reply angry / rude / unprofessional
  CHECK_REPLY_TIME: true,         // client email not answered in 24-48h
  CHECK_TASK_AFTER_TOUCH: true,   // deal worked recently but no task set
};

module.exports = { CASE_MANAGERS, SETTINGS };
