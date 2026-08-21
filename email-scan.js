// email-scan.js — THE RUNNER for the HOF Email Scanning agent.
//
// For the 12 case managers, on deals where the client is ACTIVE and the application
// is IN PROGRESS (every other status is skipped), it:
//   1. reads incoming client emails and flags anger, rudeness, refund requests and disappointment
//   2. reads our outgoing emails and flags angry, rude or unprofessional wording
//   3. flags client emails not answered within 24h (48h = serious)
//   4. flags deals worked in the last 2 hours with no open task
// then emails one HTML report to Momina, CC Ali.
//
// SAFE MODE: DRY_RUN=true scans and prints, and sends the report to nobody.

const { CASE_MANAGERS, SETTINGS } = require("./config");
const { ownersByEmail } = require("./0-hubspot");
const { fetchDeals, attach } = require("./1-fetch");
const checkTone = require("./2-check-tone");
const checkReply = require("./3-check-reply");
const checkTask = require("./4-check-task");
const { buildReport, sendReport, checkTransport, dealLink } = require("./5-report");

async function main() {
  if (!process.env.HUBSPOT_TOKEN) throw new Error("Missing HUBSPOT_TOKEN");
  console.log(`=== HOF Email Scan — ${new Date().toISOString()} ===  DRY_RUN=${SETTINGS.DRY_RUN}`);

  if (SETTINGS.SCAN_HOURS_RAW && !/^(any|0)$/i.test(SETTINGS.SCAN_HOURS_RAW) && !Number.isFinite(parseFloat(SETTINGS.SCAN_HOURS_RAW)))
    console.log(`NOTE: "${SETTINGS.SCAN_HOURS_RAW}" is not a number of hours — using 24.`);

  const windowStart = SETTINGS.SCAN_HOURS ? Date.now() - SETTINGS.SCAN_HOURS * 3600000 : 0;
  const windowLabel = SETTINGS.SCAN_HOURS ? `last ${SETTINGS.SCAN_HOURS} hour(s)` : "any time";
  console.log(`Tone scan window: ${windowLabel}`);
  console.log(`Unanswered lookback: ${SETTINGS.REPLY_LOOKBACK_HOURS}h (overdue ${SETTINGS.REPLY_DUE_HOURS}h, critical ${SETTINGS.REPLY_CRITICAL_HOURS}h)`);
  console.log(`Recent-touch task check: ${SETTINGS.TASK_TOUCH_HOURS}h`);

  const transport = await checkTransport();
  console.log(transport.ok ? `Transport: Resend OK (from ${SETTINGS.FROM_EMAIL} to ${SETTINGS.REPORT_TO})` : `!! CANNOT SEND THE REPORT — ${transport.reason}`);

  // resolve the case managers by email
  const byEmail = await ownersByEmail();
  const managers = [], missing = [];
  for (const em of CASE_MANAGERS) {
    const o = byEmail[em.toLowerCase()];
    if (o) managers.push({ ...o, email: em }); else missing.push(em);
  }
  console.log(`\nCase managers resolved: ${managers.length}/${CASE_MANAGERS.length}`);
  if (missing.length) console.log(`  NOT FOUND in HubSpot: ${missing.join(", ")}`);
  if (!managers.length) { console.log("Nothing to scan."); return; }
  const NAME = Object.fromEntries(managers.map((m) => [m.id, m.name]));

  const deals = await fetchDeals(managers.map((m) => m.id));
  console.log(`Deals to scan (Active + application in progress): ${deals.length}`);

  const clientTone = [], staffTone = [], noReply = [], noTask = [];
  let scanned = 0, skippedStatus = 0;

  for (const raw of deals) {
    let d;
    try { d = await attach(raw); }
    catch (e) { console.log(`fetch error ${raw.id}: ${e.message}`); continue; }

    // belt and braces: the search already filters, but never scan a deal that is not
    // an active client with a moving application
    if (!SETTINGS.CLIENT_STATUS_ALLOWED.includes(d.clientStatus) ||
        !SETTINGS.APPLICATION_STATUS_ALLOWED.includes(d.applicationStatus)) { skippedStatus++; continue; }
    scanned++;

    const manager = NAME[d.ownerId] || `owner ${d.ownerId}`;
    const base = { manager, dealId: d.id, dealName: d.name || d.contactName };

    try {
      for (const f of await checkTone(d, windowStart)) {
        (f.type === "client" ? clientTone : staffTone).push({ ...base, ...f });
      }
    } catch (e) { console.log(`tone error ${d.id}: ${e.message}`); }

    for (const f of checkReply(d)) noReply.push({ ...base, ...f });
    for (const f of checkTask(d)) noTask.push({ ...base, ...f });
  }

  const bySeverity = (a, b) => (a.severity === "high" ? 0 : 1) - (b.severity === "high" ? 0 : 1);
  clientTone.sort(bySeverity); staffTone.sort(bySeverity); noReply.sort((a, b) => b.hours - a.hours);

  // ---- log summary ----
  const total = clientTone.length + staffTone.length + noReply.length + noTask.length;
  console.log(`\n===== SUMMARY =====`);
  console.log(`Scanned ${scanned} deal(s) | skipped on status ${skippedStatus} | findings ${total}`);
  console.log(`  client emails flagged : ${clientTone.length}`);
  console.log(`  our emails flagged    : ${staffTone.length}`);
  console.log(`  not answered in time  : ${noReply.length}`);
  console.log(`  no task after working : ${noTask.length}`);
  console.log(`  AI calls used         : ${checkTone.aiUsage()}${checkTone.aiUsage() >= SETTINGS.MAX_AI_CALLS ? " (budget reached)" : ""}`);

  const perManager = {};
  for (const f of [...clientTone, ...staffTone, ...noReply, ...noTask]) perManager[f.manager] = (perManager[f.manager] || 0) + 1;
  if (Object.keys(perManager).length) {
    console.log(`\nFindings per case manager:`);
    for (const [m, n] of Object.entries(perManager).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${m}`);
  }
  const show = (title, arr, fmt) => {
    if (!arr.length) return;
    console.log(`\n${title}:`);
    for (const f of arr.slice(0, 15)) console.log(`  ${f.manager} — ${f.dealName}\n     ${fmt(f)}\n     ${dealLink(f.dealId)}`);
  };
  show("CLIENT EMAILS FLAGGED", clientTone, (f) => `[${f.severity}] ${f.category}${f.quote ? ` — "${f.quote}"` : ""}  (subject: ${f.subject})`);
  show("OUR EMAILS FLAGGED", staffTone, (f) => `[${f.severity}] ${f.category}${f.quote ? ` — "${f.quote}"` : ""}  (subject: ${f.subject})`);
  show("NOT ANSWERED IN TIME", noReply, (f) => `${f.hours}h without a reply — "${f.subject}"`);
  show("NO TASK AFTER WORKING", noTask, (f) => `worked ${f.minutesAgo} min ago, no open task`);

  // ---- report ----
  const html = buildReport({ clientTone, staffTone, noReply, noTask, scanned, cmCount: managers.length, windowLabel, dryRun: SETTINGS.DRY_RUN });
  require("fs").writeFileSync("email-scan-report.html", html);
  console.log(`\nWrote email-scan-report.html (download it from this run's Artifacts).`);

  if (SETTINGS.DRY_RUN) { console.log(`DRY RUN: the report was not emailed.`); return; }
  if (!transport.ok) { console.log(`Report NOT sent — ${transport.reason}`); return; }

  const ok = await sendReport(`HOF Email Scan — ${total} finding(s) across ${scanned} deals`, html);
  console.log(ok ? `Report sent to ${SETTINGS.REPORT_TO}${SETTINGS.REPORT_CC.length ? ` (cc ${SETTINGS.REPORT_CC.join(", ")})` : ""}` : `Report FAILED to send.`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
