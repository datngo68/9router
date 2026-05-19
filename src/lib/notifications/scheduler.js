// Promotes scheduled notification rows that have hit their fire time.
//
// Each due row carries the original spec in `targetSpec`. We re-resolve
// recipients now (so a broadcast scheduled yesterday still reaches users
// signed up since then), materialize per-customer in-app rows, fire external
// channels, then mark the original row 'sent'.

import {
  listDueScheduled,
  createNotification,
  markScheduledStatus,
} from "@/lib/db/repos/notificationsRepo";
import { getCustomers } from "@/lib/localDb";
import { resolveRecipients, dispatchExternal } from "./dispatch.js";

let running = false;

export async function runDueScheduled({ now = new Date().toISOString(), limit = 50 } = {}) {
  if (running) return { skipped: true, reason: "busy" };
  running = true;
  const results = [];
  try {
    const due = await listDueScheduled({ now, limit });
    for (const n of due) {
      try {
        const spec = n.targetSpec || { target: "all" };
        const channels = Array.isArray(n.channels) && n.channels.length > 0 ? n.channels : ["inapp"];
        const broadcast = spec?.target === "all";

        if (channels.includes("inapp")) {
          if (broadcast) {
            // We reuse the already-existing scheduled row by promoting it
            // in place — this avoids creating a duplicate broadcast row.
            await markScheduledStatus(n.id, { status: "sent", sentAt: new Date().toISOString() });
          } else {
            const recipients = await resolveRecipients(spec);
            for (const c of recipients) {
              await createNotification({
                customerId: c.id,
                title: n.title,
                body: n.body,
                type: n.type,
                link: n.link,
                channels,
                createdBy: n.createdBy,
                status: "sent",
              });
            }
            await markScheduledStatus(n.id, { status: "sent", sentAt: new Date().toISOString() });
          }
        } else {
          // No in-app channel: just mark sent so it leaves the scheduled view.
          await markScheduledStatus(n.id, { status: "sent", sentAt: new Date().toISOString() });
        }

        if (channels.includes("email") || channels.includes("telegram")) {
          const fanout = broadcast ? await getCustomers() : await resolveRecipients(spec);
          dispatchExternal({
            customers: fanout,
            channels,
            title: n.title,
            body: n.body,
            link: n.link,
          }).catch((e) => console.log("[notifications/scheduler] dispatch failed:", e.message));
        }
        results.push({ id: n.id, ok: true });
      } catch (e) {
        console.log("[notifications/scheduler] failed:", n.id, e.message);
        try { await markScheduledStatus(n.id, { status: "failed" }); } catch {}
        results.push({ id: n.id, ok: false, error: e.message });
      }
    }
    return { processed: results.length, results };
  } finally {
    running = false;
  }
}

let interval = null;
const TICK_MS = 60_000;

export function startNotificationScheduler() {
  if (interval) return;
  interval = setInterval(() => {
    runDueScheduled().catch((e) => console.log("[notifications/scheduler] tick failed:", e.message));
  }, TICK_MS);
  if (interval.unref) interval.unref();
}
