export default {
  version: 9,
  name: "storefront",
  up(db) {
    // ── customers ────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        passwordHash TEXT,
        telegramChatId TEXT,
        displayName TEXT,
        phone TEXT,
        emailVerified INTEGER DEFAULT 0,
        notes TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_cust_email ON customers(email)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_cust_tg ON customers(telegramChatId)`);

    // ── customerSessions ─────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS customerSessions (
        id TEXT PRIMARY KEY,
        customerId TEXT NOT NULL,
        tokenHash TEXT UNIQUE NOT NULL,
        expiresAt TEXT NOT NULL,
        ipAddress TEXT,
        userAgent TEXT,
        createdAt TEXT NOT NULL,
        revokedAt TEXT
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_cs_cid ON customerSessions(customerId)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_cs_token ON customerSessions(tokenHash)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_cs_exp ON customerSessions(expiresAt)`);

    // ── pricingPlans ─────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS pricingPlans (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        priceVnd INTEGER NOT NULL DEFAULT 0,
        dailyTokenLimit INTEGER DEFAULT 0,
        monthlyTokenLimit INTEGER DEFAULT 0,
        lifetimeTokenLimit INTEGER DEFAULT 0,
        requestsPerMinute INTEGER DEFAULT 0,
        maxTokensPerRequest INTEGER DEFAULT 0,
        expiresAfterDays INTEGER DEFAULT 0,
        allowedModels TEXT DEFAULT '[]',
        isActive INTEGER DEFAULT 1,
        sortOrder INTEGER DEFAULT 0,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_pp_active ON pricingPlans(isActive)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_pp_kind ON pricingPlans(kind)`);

    // ── orders ───────────────────────────────────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        customerId TEXT NOT NULL,
        planId TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        priceVnd INTEGER NOT NULL DEFAULT 0,
        paymentMethod TEXT,
        paymentRef TEXT,
        apiKeyId TEXT,
        notes TEXT,
        createdAt TEXT NOT NULL,
        paidAt TEXT,
        deliveredAt TEXT,
        cancelledAt TEXT,
        refundedAt TEXT
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ord_customer ON orders(customerId)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ord_status ON orders(status)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ord_created ON orders(createdAt DESC)`);

    // ── apiKeys: link to customer + order ────────────────────────────────
    const cols = new Set(db.all(`PRAGMA table_info(apiKeys)`).map((r) => r.name));
    if (!cols.has("customerId")) {
      db.exec(`ALTER TABLE apiKeys ADD COLUMN customerId TEXT`);
    }
    if (!cols.has("orderId")) {
      db.exec(`ALTER TABLE apiKeys ADD COLUMN orderId TEXT`);
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ak_customer ON apiKeys(customerId)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ak_order ON apiKeys(orderId)`);
  },
};
