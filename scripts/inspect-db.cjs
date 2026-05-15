const Database = require("better-sqlite3");
const path = require("path");

const dbPath = path.join(process.env.APPDATA, "9router", "db", "data.sqlite");
const db = new Database(dbPath, { readonly: true });

console.log("=== _meta entries ===");
console.log(db.prepare("SELECT * FROM _meta").all());

console.log("\n=== apiKeys columns ===");
console.log(db.prepare("PRAGMA table_info(apiKeys)").all().map(c => `${c.name}: ${c.type}`).join("\n"));

console.log("\n=== usageHistory columns ===");
console.log(db.prepare("PRAGMA table_info(usageHistory)").all().map(c => `${c.name}: ${c.type}`).join("\n"));

console.log("\n=== providerConnections columns ===");
console.log(db.prepare("PRAGMA table_info(providerConnections)").all().map(c => `${c.name}: ${c.type}`).join("\n"));

// sample apiKey row to see if columns are populated
console.log("\n=== sample apiKey row ===");
console.log(db.prepare("SELECT * FROM apiKeys LIMIT 1").get());

console.log("\n=== keyAuditLog exists? ===");
try { console.log(db.prepare("SELECT COUNT(*) AS n FROM keyAuditLog").get()); } catch (e) { console.log("table missing:", e.message); }

db.close();
