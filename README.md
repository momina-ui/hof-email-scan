# HOF Email Scan

Reads the emails on case managers' active files and flags the ones that need a human
eye: angry or disappointed clients, refund requests, rude replies from our own side,
clients left waiting, and files worked without a next task. Sends one HTML report to
Momina. Runs on GitHub Actions from Momina's own repo.

---

## Who and what is scanned

**12 case managers:** thushara, tamjeed, anwar, maryamchand, rahima, hashimtahir,
alitariq, warda, brenda, umer, yamina, muhammadzaryab (all @hofmigration.com).
Only the email address is configured — the owner IDs are looked up in HubSpot at run
time, and any address that does not resolve is named in the log.

**Only these deals are scanned:**
- **Touched by the case manager recently** — nothing older is looked at
- Client Status = **Active**
- Application Status = **In Progress** *or* **In Process**

Each check has its own touch window:

| Check | Deals touched within |
|---|---|
| Unanswered client emails | **48 hours** |
| Missing task | **24 hours** |
| Email tone | the fetch window (hours box, default 48) |

Every other status is skipped. (The portal genuinely has both "In Progress" and
"In Process" as separate values, so both are accepted — otherwise half the files
would be missed.)

---

## The four checks

| # | Check | Rule |
|---|---|---|
| 1 | **Client email tone** | Only unmistakable cases: explicit anger, insults, an actual **refund demand**, or strong stated dissatisfaction with HOF. Chasing for updates, impatience, and frustration at embassies or delays are **not** flagged. |
| 2 | **Our email tone** | Only genuinely rude, sarcastic, dismissive or aggressive wording. Blunt, firm or bad-news emails are **not** flagged. |
| 3 | **Not answered in time** | A client email that **actually needed a reply** and did not get one: overdue at **24h**, serious at **48h**. Thank-yous, acknowledgements, auto-replies and plain document drops are never chased — the email is read first to decide whether an answer was required. |
| 4 | **No task after working** | The file was worked in the **last 24 hours** but has no open task. Completed tasks don't count. |

Every finding carries a **direct deal link**.

Both tone checks require **high confidence plus the exact words** that prove it, and
the report shows that quote — so every flag can be judged in a second.

Notes on accuracy: only email **text** is read — attachments and screenshots are
invisible. Quoted history is trimmed before the AI reads an email, so an old angry
line in a reply chain is not counted again on every reply. Both tone checks are
instructed to be strict: a normal chase for an update, or a firm-but-polite reply,
is not a flag.

---

## Running it

**Actions → Email Scan → Run workflow.**

| Input | Choices |
|---|---|
| Dry run | `true` = scan and print, send nothing · `false` = send the report |
| Hours back | **Type any number** of hours. Only deals touched within that window are scanned. Default 48. |
| How many deals | all / 25 / 50 / 100 / 250 / 500 |
| Sender | `onboarding@resend.dev` (default) or `noreply@hofmigration.com` |

Scheduled daily at **11:00 AM PKT**, after the contact and deal audits.

The HTML report is also saved as a downloadable artifact on every run, so a dry run
still lets you see exactly what would be sent.

---

## Setup (Momina's own repo)

Three secrets, added in **Settings → Secrets and variables → Actions → Secrets**:

| Secret | Where it comes from |
|---|---|
| `HUBSPOT_TOKEN` | the shared HOF private app token (same one Ali uses) |
| `GEMINI_KEY` | a Google AI Studio key on Momina's own Google account |
| `RESEND_KEY` | an API key from Momina's own Resend account |

**Register the Resend account with momina@hofmigration.com.** Resend's built-in test
sender `onboarding@resend.dev` only delivers to the address the account was registered
with — so with her own account, the report reaches her immediately and no domain
verification or DNS work is needed.

If hofmigration.com is verified in Resend later, switch the sender dropdown to
`noreply@hofmigration.com` and the report can then go to anyone.

No npm packages are installed — the agent runs on plain Node.

## Tuning (`config.js`)

`REPLY_DUE_HOURS` (24) · `REPLY_CRITICAL_HOURS` (48) · `TOUCHED_WITHIN_HOURS` (48, from the hours box) · `REPLY_TOUCH_HOURS` (48) · `TASK_TOUCH_HOURS` (24) · `REPLY_LOOKBACK_HOURS` (168, email history on those deals) ·
`TASK_TOUCH_HOURS` (2) · `MAX_EMAILS_PER_DEAL` (8) · `MAX_AI_CALLS` (400) ·
`CHECK_INCOMING_TONE` · `CHECK_OUTGOING_TONE` · `CHECK_REPLY_TIME` ·
`CHECK_TASK_AFTER_TOUCH` · `CASE_MANAGERS` · `REPORT_TO` · `REPORT_CC` (empty by default — add addresses to copy others in)

**Cost:** the tone check is one AI call per email, capped by `MAX_AI_CALLS` per run.
If the cap is hit, the log says so — lower `MAX_EMAILS_PER_DEAL` or the hours window.

## Changing the rules

Every rule is a scenario in `selftest.js`. Run `node selftest.js` after any edit —
it reports `35 passed, 0 failed` and names anything that broke. The workflow runs it
before scanning, so a broken rule stops the run instead of producing a wrong report.
