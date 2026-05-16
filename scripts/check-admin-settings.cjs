const Database = require("better-sqlite3");
const path = require("path");

const dbPath = path.join(process.env.APPDATA, "9router", "db", "data.sqlite");
const db = new Database(dbPath, { readonly: true });

const row = db.prepare("SELECT data FROM settings WHERE id = 1").get();
const parsed = row ? JSON.parse(row.data) : {};
console.log("=== persisted admin settings ===");
console.log({
  adminHosts: parsed.adminHosts || "(empty)",
  adminPathPrefix: parsed.adminPathPrefix || "(empty)",
  storeUrl: parsed.storeUrl || "(empty)",
  requireLogin: parsed.requireLogin,
});

db.close();
