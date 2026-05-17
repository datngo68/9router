// Latest schema version — bumped when a migration is added in ./migrations/
export const SCHEMA_VERSION = 10;

export const PRAGMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;
PRAGMA mmap_size = 30000000;
PRAGMA cache_size = -64000;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
`;

// Declarative current schema. Used by syncSchemaFromTables() to
// auto-add missing tables/columns/indexes after versioned migrations.
// For destructive changes (drop/rename/type-change), write a migration file.
export const TABLES = {
  _meta: {
    columns: {
      key: "TEXT PRIMARY KEY",
      value: "TEXT NOT NULL",
    },
  },
  settings: {
    columns: {
      id: "INTEGER PRIMARY KEY CHECK (id = 1)",
      data: "TEXT NOT NULL",
    },
  },
  providerConnections: {
    columns: {
      id: "TEXT PRIMARY KEY",
      provider: "TEXT NOT NULL",
      authType: "TEXT NOT NULL",
      name: "TEXT",
      email: "TEXT",
      priority: "INTEGER",
      isActive: "INTEGER DEFAULT 1",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_pc_provider ON providerConnections(provider)",
      "CREATE INDEX IF NOT EXISTS idx_pc_provider_active ON providerConnections(provider, isActive)",
      "CREATE INDEX IF NOT EXISTS idx_pc_priority ON providerConnections(provider, priority)",
    ],
  },
  providerNodes: {
    columns: {
      id: "TEXT PRIMARY KEY",
      type: "TEXT",
      name: "TEXT",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_pn_type ON providerNodes(type)"],
  },
  proxyPools: {
    columns: {
      id: "TEXT PRIMARY KEY",
      isActive: "INTEGER DEFAULT 1",
      testStatus: "TEXT",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_pp_active ON proxyPools(isActive)",
      "CREATE INDEX IF NOT EXISTS idx_pp_status ON proxyPools(testStatus)",
    ],
  },
  apiKeys: {
    columns: {
      id: "TEXT PRIMARY KEY",
      key: "TEXT",
      keyHash: "TEXT UNIQUE",
      keyPrefix: "TEXT",
      keyLast4: "TEXT",
      name: "TEXT",
      machineId: "TEXT",
      isActive: "INTEGER DEFAULT 1",
      dailyTokenLimit: "INTEGER DEFAULT 0",
      monthlyTokenLimit: "INTEGER DEFAULT 0",
      lifetimeTokenLimit: "INTEGER DEFAULT 0",
      requestsPerMinute: "INTEGER DEFAULT 0",
      maxTokensPerRequest: "INTEGER DEFAULT 0",
      expiresAt: "TEXT",
      allowedModels: "TEXT DEFAULT '[]'",
      allowedIps: "TEXT DEFAULT '[]'",
      customerId: "TEXT",
      orderId: "TEXT",
      createdAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_ak_key ON apiKeys(key)",
      "CREATE INDEX IF NOT EXISTS idx_ak_keyhash ON apiKeys(keyHash)",
      "CREATE INDEX IF NOT EXISTS idx_ak_customer ON apiKeys(customerId)",
      "CREATE INDEX IF NOT EXISTS idx_ak_order ON apiKeys(orderId)",
    ],
  },
  keyAuditLog: {
    columns: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      timestamp: "TEXT NOT NULL",
      keyId: "TEXT",
      action: "TEXT NOT NULL",
      actorIp: "TEXT",
      metadata: "TEXT",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_kal_keyid ON keyAuditLog(keyId)",
      "CREATE INDEX IF NOT EXISTS idx_kal_ts ON keyAuditLog(timestamp DESC)",
      "CREATE INDEX IF NOT EXISTS idx_kal_action ON keyAuditLog(action)",
    ],
  },
  customers: {
    columns: {
      id: "TEXT PRIMARY KEY",
      email: "TEXT UNIQUE NOT NULL",
      passwordHash: "TEXT",
      telegramChatId: "TEXT",
      displayName: "TEXT",
      phone: "TEXT",
      emailVerified: "INTEGER DEFAULT 0",
      notes: "TEXT",
      googleSub: "TEXT",
      authProvider: "TEXT DEFAULT 'password'",
      totpSecret: "TEXT",
      totpEnabled: "INTEGER DEFAULT 0",
      totpVerifiedAt: "TEXT",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_cust_email ON customers(email)",
      "CREATE INDEX IF NOT EXISTS idx_cust_tg ON customers(telegramChatId)",
      "CREATE INDEX IF NOT EXISTS idx_cust_google ON customers(googleSub)",
    ],
  },
  customerSessions: {
    columns: {
      id: "TEXT PRIMARY KEY",
      customerId: "TEXT NOT NULL",
      tokenHash: "TEXT UNIQUE NOT NULL",
      expiresAt: "TEXT NOT NULL",
      ipAddress: "TEXT",
      userAgent: "TEXT",
      createdAt: "TEXT NOT NULL",
      revokedAt: "TEXT",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_cs_cid ON customerSessions(customerId)",
      "CREATE INDEX IF NOT EXISTS idx_cs_token ON customerSessions(tokenHash)",
      "CREATE INDEX IF NOT EXISTS idx_cs_exp ON customerSessions(expiresAt)",
    ],
  },
  pricingPlans: {
    columns: {
      id: "TEXT PRIMARY KEY",
      kind: "TEXT NOT NULL",
      name: "TEXT NOT NULL",
      description: "TEXT",
      priceVnd: "INTEGER NOT NULL DEFAULT 0",
      dailyTokenLimit: "INTEGER DEFAULT 0",
      monthlyTokenLimit: "INTEGER DEFAULT 0",
      lifetimeTokenLimit: "INTEGER DEFAULT 0",
      requestsPerMinute: "INTEGER DEFAULT 0",
      maxTokensPerRequest: "INTEGER DEFAULT 0",
      expiresAfterDays: "INTEGER DEFAULT 0",
      allowedModels: "TEXT DEFAULT '[]'",
      isActive: "INTEGER DEFAULT 1",
      sortOrder: "INTEGER DEFAULT 0",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_pp_active ON pricingPlans(isActive)",
      "CREATE INDEX IF NOT EXISTS idx_pp_kind ON pricingPlans(kind)",
    ],
  },
  orders: {
    columns: {
      id: "TEXT PRIMARY KEY",
      customerId: "TEXT NOT NULL",
      planId: "TEXT NOT NULL",
      status: "TEXT NOT NULL DEFAULT 'pending'",
      priceVnd: "INTEGER NOT NULL DEFAULT 0",
      paymentMethod: "TEXT",
      paymentRef: "TEXT",
      apiKeyId: "TEXT",
      notes: "TEXT",
      createdAt: "TEXT NOT NULL",
      paidAt: "TEXT",
      deliveredAt: "TEXT",
      cancelledAt: "TEXT",
      refundedAt: "TEXT",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_ord_customer ON orders(customerId)",
      "CREATE INDEX IF NOT EXISTS idx_ord_status ON orders(status)",
      "CREATE INDEX IF NOT EXISTS idx_ord_created ON orders(createdAt DESC)",
    ],
  },
  combos: {
    columns: {
      id: "TEXT PRIMARY KEY",
      name: "TEXT UNIQUE NOT NULL",
      kind: "TEXT",
      models: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_combo_name ON combos(name)"],
  },
  kv: {
    columns: {
      scope: "TEXT NOT NULL",
      key: "TEXT NOT NULL",
      value: "TEXT NOT NULL",
    },
    primaryKey: "PRIMARY KEY (scope, key)",
    indexes: ["CREATE INDEX IF NOT EXISTS idx_kv_scope ON kv(scope)"],
  },
  usageHistory: {
    columns: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      timestamp: "TEXT NOT NULL",
      provider: "TEXT",
      model: "TEXT",
      connectionId: "TEXT",
      apiKey: "TEXT",
      apiKeyId: "TEXT",
      endpoint: "TEXT",
      promptTokens: "INTEGER DEFAULT 0",
      completionTokens: "INTEGER DEFAULT 0",
      cost: "REAL DEFAULT 0",
      status: "TEXT",
      tokens: "TEXT",
      meta: "TEXT",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_uh_ts ON usageHistory(timestamp DESC)",
      "CREATE INDEX IF NOT EXISTS idx_uh_provider ON usageHistory(provider)",
      "CREATE INDEX IF NOT EXISTS idx_uh_model ON usageHistory(model)",
      "CREATE INDEX IF NOT EXISTS idx_uh_conn ON usageHistory(connectionId)",
      "CREATE INDEX IF NOT EXISTS idx_uh_apikeyid ON usageHistory(apiKeyId)",
    ],
  },
  usageDaily: {
    columns: {
      dateKey: "TEXT PRIMARY KEY",
      data: "TEXT NOT NULL",
    },
  },
  requestDetails: {
    columns: {
      id: "TEXT PRIMARY KEY",
      timestamp: "TEXT NOT NULL",
      provider: "TEXT",
      model: "TEXT",
      connectionId: "TEXT",
      status: "TEXT",
      data: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_rd_ts ON requestDetails(timestamp DESC)",
      "CREATE INDEX IF NOT EXISTS idx_rd_provider ON requestDetails(provider)",
      "CREATE INDEX IF NOT EXISTS idx_rd_model ON requestDetails(model)",
      "CREATE INDEX IF NOT EXISTS idx_rd_conn ON requestDetails(connectionId)",
    ],
  },
};

export function buildCreateTableSql(name, def) {
  const cols = Object.entries(def.columns).map(([k, v]) => `${k} ${v}`);
  if (def.primaryKey) cols.push(def.primaryKey);
  return `CREATE TABLE IF NOT EXISTS ${name} (${cols.join(", ")})`;
}
