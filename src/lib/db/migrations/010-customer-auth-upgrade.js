export default {
  version: 10,
  name: "customer-auth-upgrade",
  up(db) {
    const cols = new Set(db.all(`PRAGMA table_info(customers)`).map((r) => r.name));
    const add = (name, sql) => {
      if (!cols.has(name)) db.exec(`ALTER TABLE customers ADD COLUMN ${name} ${sql}`);
    };

    add("googleSub", "TEXT");
    add("authProvider", "TEXT DEFAULT 'password'");
    add("totpSecret", "TEXT");
    add("totpEnabled", "INTEGER DEFAULT 0");
    add("totpVerifiedAt", "TEXT");
    db.exec(`CREATE INDEX IF NOT EXISTS idx_cust_google ON customers(googleSub)`);
  },
};
