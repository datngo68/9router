// Customers repo — storefront end-users.
//
// Passwords stored as bcrypt hashes. Email is the unique handle used for
// login + dedupe. Caller must lowercase/trim the email before passing in.

import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";
import { getAdapter } from "../driver.js";

const BCRYPT_COST = 10;

function rowToCustomer(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    // never expose passwordHash to UI
    passwordHash: row.passwordHash,
    telegramChatId: row.telegramChatId || null,
    displayName: row.displayName || null,
    phone: row.phone || null,
    emailVerified: row.emailVerified === 1,
    notes: row.notes || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function publicView(customer) {
  if (!customer) return null;
  const { passwordHash: _ph, ...rest } = customer;
  return rest;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export async function getCustomers() {
  const db = await getAdapter();
  return db.all(`SELECT * FROM customers ORDER BY createdAt DESC`).map(rowToCustomer).map(publicView);
}

export async function getCustomerById(id, { withPassword = false } = {}) {
  if (!id) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM customers WHERE id = ?`, [id]);
  const c = rowToCustomer(row);
  return withPassword ? c : publicView(c);
}

export async function findCustomerByEmail(email, { withPassword = false } = {}) {
  const e = normalizeEmail(email);
  if (!e) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM customers WHERE email = ?`, [e]);
  const c = rowToCustomer(row);
  return withPassword ? c : publicView(c);
}

export async function createCustomer({ email, password, displayName, phone, telegramChatId }) {
  const e = normalizeEmail(email);
  if (!e) throw new Error("email is required");
  if (!password || String(password).length < 8) throw new Error("password must be at least 8 characters");

  const db = await getAdapter();
  const existing = db.get(`SELECT id FROM customers WHERE email = ?`, [e]);
  if (existing) throw new Error("email already registered");

  const id = uuidv4();
  const passwordHash = await bcrypt.hash(String(password), BCRYPT_COST);
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO customers(id, email, passwordHash, displayName, phone, telegramChatId, emailVerified, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, e, passwordHash, displayName || null, phone || null, telegramChatId || null, 0, now, now]
  );
  return publicView(await getCustomerById(id, { withPassword: true }));
}

/**
 * Verify password. Returns the customer (without hash) on match, or null.
 * Always performs the bcrypt compare even when the email is missing, so
 * timing-attack surface is consistent.
 */
export async function verifyCustomerPassword(email, password) {
  const customer = await findCustomerByEmail(email, { withPassword: true });
  const dummyHash = "$2b$10$0123456789012345678901uQz0z0z0z0z0z0z0z0z0z0z0z0z0z0z";
  const ok = await bcrypt.compare(String(password || ""), customer?.passwordHash || dummyHash);
  if (!customer) return null;
  if (!ok) return null;
  return publicView(customer);
}

export async function setCustomerPassword(id, newPassword) {
  if (!newPassword || String(newPassword).length < 8) throw new Error("password must be at least 8 characters");
  const db = await getAdapter();
  const passwordHash = await bcrypt.hash(String(newPassword), BCRYPT_COST);
  const now = new Date().toISOString();
  db.run(`UPDATE customers SET passwordHash = ?, updatedAt = ? WHERE id = ?`, [passwordHash, now, id]);
  return publicView(await getCustomerById(id));
}

export async function updateCustomer(id, patch = {}) {
  const db = await getAdapter();
  const existing = await getCustomerById(id, { withPassword: true });
  if (!existing) return null;
  const fields = ["displayName", "phone", "telegramChatId", "notes"];
  const sets = [];
  const params = [];
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(patch, f)) {
      sets.push(`${f} = ?`);
      params.push(patch[f] ?? null);
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, "emailVerified")) {
    sets.push(`emailVerified = ?`);
    params.push(patch.emailVerified ? 1 : 0);
  }
  if (sets.length === 0) return publicView(existing);
  sets.push(`updatedAt = ?`);
  params.push(new Date().toISOString());
  params.push(id);
  db.run(`UPDATE customers SET ${sets.join(", ")} WHERE id = ?`, params);
  return publicView(await getCustomerById(id));
}

export async function markEmailVerified(id) {
  return updateCustomer(id, { emailVerified: true });
}

export async function deleteCustomer(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM customers WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}
