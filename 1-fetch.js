// 1-fetch.js — finds the deals worth scanning and loads their emails and tasks.
// Only Active clients whose application is still moving are scanned; every other
// client or application status is skipped before anything else happens.
const { hub, assocIds, batchRead, strip, when } = require("./0-hubspot");
const { SETTINGS } = require("./config");

// Only deals the case manager has TOUCHED within this window are scanned at all.
// (The reply check still reads older email history, but only on these deals.)
function lookbackStart() {
  const hours = SETTINGS.TOUCHED_WITHIN_HOURS || 0;
  return hours ? Date.now() - hours * 3600000 : 0;
}

async function fetchDeals(ownerIds) {
  const start = lookbackStart();
  const filters = [
    { propertyName: "hubspot_owner_id", operator: "IN", values: ownerIds },
    { propertyName: "client_status", operator: "IN", values: SETTINGS.CLIENT_STATUS_ALLOWED },
    { propertyName: "application_status", operator: "IN", values: SETTINGS.APPLICATION_STATUS_ALLOWED },
  ];
  const props = ["dealname", "hubspot_owner_id", "client_status", "application_status",
    "dealstage", "pipeline", "notes_last_contacted", "hs_lastmodifieddate"];

  const out = []; let after;
  for (let page = 0; page < 200; page++) {
    const d = await hub("POST", "/crm/v3/objects/deals/search", {
      filterGroups: [{ filters }],
      sorts: [{ propertyName: "notes_last_contacted", direction: "DESCENDING" }],
      properties: props, limit: 100, after,
    });
    let stop = false;
    for (const deal of d.results || []) {
      const lc = deal.properties.notes_last_contacted ? Date.parse(deal.properties.notes_last_contacted) : 0;
      if (start && lc && lc < start) { stop = true; break; }     // sorted desc: past the window
      out.push(deal);
      if (SETTINGS.MAX_DEALS && out.length >= SETTINGS.MAX_DEALS) { stop = true; break; }
    }
    after = d.paging?.next?.after;
    if (stop || !after) break;
  }
  return out;
}

async function attach(deal) {
  const [emailA, taskA, contactA] = await Promise.all([
    assocIds("deals", deal.id, "emails"),
    assocIds("deals", deal.id, "tasks"),
    assocIds("deals", deal.id, "contacts"),
  ]);
  const [emailR, taskR, contactR] = await Promise.all([
    batchRead("emails", emailA.ids, ["hs_email_subject", "hs_email_text", "hs_email_html", "hs_email_direction", "hs_timestamp", "hs_createdate", "hs_email_from_email", "hs_email_status"]),
    batchRead("tasks", taskA.ids, ["hs_task_subject", "hs_task_status", "hs_timestamp", "hs_createdate"]),
    batchRead("contacts", contactA.ids, ["firstname", "lastname", "email"]),
  ]);

  const available = { emails: emailA.ok && emailR.ok, tasks: taskA.ok && taskR.ok, contact: contactA.ok && contactR.ok };
  const p = deal.properties;
  const contact = contactR.records[0]?.properties || null;

  const emails = emailR.records.map((x) => {
    const pr = x.properties;
    const dir = String(pr.hs_email_direction || "").toUpperCase();
    return {
      id: x.id,
      incoming: dir === "INCOMING_EMAIL",
      when: when(pr),
      subject: pr.hs_email_subject || "",
      from: pr.hs_email_from_email || "",
      text: strip(pr.hs_email_text || pr.hs_email_html).slice(0, 4000),
    };
  }).filter((e) => e.when).sort((a, b) => b.when - a.when);

  return {
    id: deal.id,
    name: p.dealname || `Deal ${deal.id}`,
    ownerId: p.hubspot_owner_id,
    clientStatus: p.client_status || null,
    applicationStatus: p.application_status || null,
    lastTouched: p.notes_last_contacted ? Date.parse(p.notes_last_contacted) : 0,
    available,
    emails,
    tasks: taskR.records.map((x) => x.properties),
    contactName: contact ? [contact.firstname, contact.lastname].filter(Boolean).join(" ").trim() : "",
    contactEmail: contact?.email || "",
  };
}

module.exports = { fetchDeals, attach, lookbackStart };
