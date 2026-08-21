// 5-report.js — builds the HTML report and sends it.
// Styled like the HOF Daily Email QA report: navy header, stats line, sectioned card.
const T = require("./email-template");
const { SETTINGS } = require("./config");

const dealLink = (id) => `https://app.hubspot.com/contacts/${SETTINGS.PORTAL_ID}/record/0-3/${id}`;
const stamp = (ms) => (ms ? new Date(ms + SETTINGS.TZ_OFFSET_HOURS * 3600000).toISOString().slice(0, 16).replace("T", " ") : "");
const CAT = { angry: "Angry", rude: "Rude", refund: "Refund request", disappointed: "Disappointed", unprofessional: "Unprofessional", tone: "Tone", concern: "Concern" };

function section(title, rows) {
  if (!rows.length) return "";
  return T.sectionTitle(`${title} — ${rows.length}`) + rows.join("");
}

function buildReport({ clientTone, staffTone, noReply, noTask, scanned, cmCount, windowLabel, dryRun }) {
  const line = (f, i, arr, extra) => T.row({
    name: f.manager, count: null, title: f.dealName,
    link: dealLink(f.dealId), linkLabel: "Open deal",
    details: extra, last: i === arr.length - 1,
  });

  const clientRows = clientTone.map((f, i, a) => line(f, i, a, [
    `<strong style="color:${f.severity === "high" ? "#c0392b" : "#b9770e"};">${CAT[f.category] || f.category}</strong>` +
    `${f.quote ? ` &mdash; &ldquo;${T.esc(f.quote)}&rdquo;` : ""}`,
    `subject: ${T.esc(f.subject || "(none)")} &middot; ${stamp(f.when)}`,
  ]));

  const staffRows = staffTone.map((f, i, a) => line(f, i, a, [
    `<strong style="color:#c0392b;">${CAT[f.category] || f.category}</strong>${f.quote ? ` &mdash; &ldquo;${T.esc(f.quote)}&rdquo;` : ""}`,
    `subject: ${T.esc(f.subject || "(none)")} &middot; ${stamp(f.when)}`,
  ]));

  const replyRows = noReply.map((f, i, a) => line(f, i, a, [
    `<strong style="color:${f.severity === "high" ? "#c0392b" : "#b9770e"};">${f.hours}h without a reply</strong>` +
    `${f.count > 1 ? ` &middot; ${f.count} unanswered emails` : ""}`,
    `subject: ${T.esc(f.subject || "(none)")} &middot; received ${stamp(f.when)}`,
  ]));

  const taskRows = noTask.map((f, i, a) => line(f, i, a, [
    `Worked ${f.minutesAgo} minute(s) ago with no open task${f.hadCompleted ? " (previous task completed)" : ""}`,
  ]));

  const total = clientTone.length + staffTone.length + noReply.length + noTask.length;

  const body =
    (dryRun ? T.callout("<strong>DRY RUN / PREVIEW.</strong> This report was not sent to anyone else.", "warn") : "") +
    (clientTone.some((f) => f.severity === "high") || staffTone.length
      ? T.callout(`<strong>Needs attention today.</strong> ${staffTone.length ? `${staffTone.length} of our own email(s) flagged for tone. ` : ""}${clientTone.filter((f) => f.severity === "high").length} client email(s) flagged as high severity.`, "alert")
      : "") +
    T.paragraph(`Active clients with an application in progress, across <strong>${cmCount}</strong> case managers. <strong>${scanned}</strong> deal(s) scanned, <strong>${total}</strong> finding(s).`) +
    section("Client emails needing attention", clientRows) +
    section("Our emails flagged for tone", staffRows) +
    section("Client emails not answered in time", replyRows) +
    section("Worked recently with no task set", taskRows) +
    (total === 0 ? T.paragraph("Nothing flagged in this window.") : "") +
    T.footer(`Window: ${windowLabel}.`);

  return T.shell({
    title: "HOF Email Scan",
    subtitle: `${windowLabel} &middot; ${scanned} deals &middot; ${total} findings`,
    body,
  });
}

// ---- sending (Resend only; no extra packages needed) ----
async function sendReport(subject, html) {
  if (!process.env.RESEND_KEY) { console.log("No RESEND_KEY secret set."); return false; }
  const body = { from: SETTINGS.FROM_EMAIL, to: [SETTINGS.REPORT_TO], subject, html };
  if (SETTINGS.REPORT_CC && SETTINGS.REPORT_CC.length) body.cc = SETTINGS.REPORT_CC;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = (await res.text()).slice(0, 250);
    console.log(`Report failed to send: ${res.status} ${t}`);
    if (res.status === 403 && SETTINGS.FROM_EMAIL.endsWith("resend.dev")) {
      console.log(`  The test sender only delivers to the address this Resend account was`);
      console.log(`  registered with. Make sure the Resend account is registered with`);
      console.log(`  ${SETTINGS.REPORT_TO}, or verify hofmigration.com and use noreply@hofmigration.com.`);
    }
    return false;
  }
  return true;
}

async function checkTransport() {
  if (!process.env.RESEND_KEY) return { ok: false, reason: "RESEND_KEY secret is missing" };
  return { ok: true };
}

module.exports = { buildReport, sendReport, checkTransport, dealLink };
