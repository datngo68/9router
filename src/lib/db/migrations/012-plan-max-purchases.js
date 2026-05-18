// Add per-customer purchase limit on pricing plans.
//   maxPurchasesPerCustomer = 0  → unlimited (default; existing plans keep
//                                  current behavior).
//   maxPurchasesPerCustomer > 0  → enforce limit at order creation time;
//                                  count counts orders in pending / paid /
//                                  delivered statuses (cancelled and refunded
//                                  do NOT consume a purchase slot).
export default {
  version: 12,
  name: "plan-max-purchases",
  up(db) {
    const cols = new Set(db.all(`PRAGMA table_info(pricingPlans)`).map((r) => r.name));
    if (!cols.has("maxPurchasesPerCustomer")) {
      db.exec(`ALTER TABLE pricingPlans ADD COLUMN maxPurchasesPerCustomer INTEGER DEFAULT 0`);
    }
  },
};
