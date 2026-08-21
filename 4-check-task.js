// 4-check-task.js — a deal worked in the last couple of hours with no task set.
//
// Rule: the deal was touched within TASK_TOUCH_HOURS but has no OPEN task on it, so
// nothing schedules the next step. Completed tasks do not count, and our own
// "[Compliance]" tasks never count.
const { SETTINGS } = require("./config");

const DONE = ["completed"];

module.exports = function checkTask(d) {
  if (!SETTINGS.CHECK_TASK_AFTER_TOUCH || !d.available.tasks) return [];

  const cutoff = Date.now() - (SETTINGS.TASK_TOUCH_HOURS || 2) * 3600000;
  if (!d.lastTouched || d.lastTouched < cutoff) return [];       // not worked recently

  const open = d.tasks.filter((t) => {
    const subj = String(t.hs_task_subject || "").toLowerCase();
    if (subj.startsWith("[compliance]")) return false;
    return !DONE.includes(String(t.hs_task_status || "").toLowerCase());
  });
  if (open.length) return [];

  const mins = Math.max(1, Math.round((Date.now() - d.lastTouched) / 60000));
  return [{
    type: "notask",
    severity: "medium",
    minutesAgo: mins,
    hadCompleted: d.tasks.length > 0,
  }];
};
