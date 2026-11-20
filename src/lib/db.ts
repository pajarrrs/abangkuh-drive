import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { hashPin } from "./auth-crypto";
import { getJakartaNow, isWithinSessionSchedule } from "./format";
import type { OrderSession } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "abangkuh.db");
const SCHEMA_VERSION = 4;

declare global {
  var __abangkuhDb: DatabaseSync | undefined;
  var __abangkuhSchemaVersion: number | undefined;
}

function createSchema(db: DatabaseSync) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      division TEXT NOT NULL DEFAULT '',
      whatsapp TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL CHECK(role IN ('EMPLOYEE', 'OB', 'ADMIN')) DEFAULT 'EMPLOYEE',
      pin_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS merchants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL DEFAULT 'Makanan',
      location_note TEXT NOT NULL DEFAULT '',
      default_qris_image TEXT DEFAULT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS menu_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      merchant_id INTEGER NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      estimated_price INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS order_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_date TEXT NOT NULL,
      slot TEXT NOT NULL CHECK(slot IN ('SIANG', 'SORE')),
      label TEXT NOT NULL,
      open_time TEXT NOT NULL,
      close_time TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('OPEN', 'SHOPPING', 'COMPLETED')) DEFAULT 'OPEN',
      manual_override INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(session_date, slot)
    );

    CREATE TABLE IF NOT EXISTS merchant_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES order_sessions(id) ON DELETE CASCADE,
      merchant_id INTEGER REFERENCES merchants(id) ON DELETE SET NULL,
      merchant_name TEXT NOT NULL,
      assigned_ob_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      qris_image_url TEXT DEFAULT NULL,
      receipt_image_url TEXT DEFAULT NULL,
      ob_note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK(status IN ('COLLECTING', 'CLAIMED', 'QRIS_UPLOADED', 'COMPLETED')) DEFAULT 'COLLECTING',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(session_id, merchant_name)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES order_sessions(id) ON DELETE CASCADE,
      batch_id INTEGER NOT NULL REFERENCES merchant_batches(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      payment_method TEXT NOT NULL CHECK(payment_method IN ('QRIS', 'CASH')) DEFAULT 'QRIS',
      estimated_total INTEGER NOT NULL DEFAULT 0,
      actual_total INTEGER DEFAULT NULL,
      max_budget INTEGER DEFAULT NULL,
      payment_status TEXT NOT NULL CHECK(payment_status IN ('UNPAID', 'WAITING_PAYMENT', 'PROOF_UPLOADED', 'PAID', 'CANCELLED')) DEFAULT 'UNPAID',
      delivery_status TEXT NOT NULL CHECK(delivery_status IN ('PENDING', 'BOUGHT', 'DELIVERED', 'UNAVAILABLE')) DEFAULT 'PENDING',
      payment_proof_url TEXT DEFAULT NULL,
      payment_reject_reason TEXT DEFAULT NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      menu_item_id INTEGER REFERENCES menu_items(id) ON DELETE SET NULL,
      item_name TEXT NOT NULL,
      qty INTEGER NOT NULL DEFAULT 1,
      unit_price INTEGER NOT NULL DEFAULT 0,
      actual_unit_price INTEGER DEFAULT NULL,
      item_note TEXT NOT NULL DEFAULT '',
      is_unavailable INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS ob_locations (
      ob_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      accuracy REAL DEFAULT NULL,
      current_merchant_name TEXT NOT NULL DEFAULT '',
      status_label TEXT NOT NULL CHECK(status_label IN ('ON_THE_WAY', 'AT_MERCHANT', 'RETURNING', 'OFFLINE')) DEFAULT 'OFFLINE',
      is_sharing INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS phone_change_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      old_whatsapp TEXT NOT NULL DEFAULT '',
      new_whatsapp TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('PENDING', 'APPROVED', 'REJECTED')) DEFAULT 'PENDING',
      reject_reason TEXT DEFAULT NULL,
      reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      reviewed_at TEXT DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS item_price_memory (
      merchant_key TEXT NOT NULL,
      item_key TEXT NOT NULL,
      last_price INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (merchant_key, item_key)
    );

    CREATE INDEX IF NOT EXISTS idx_menu_items_merchant ON menu_items(merchant_id);
    CREATE INDEX IF NOT EXISTS idx_phone_req_status ON phone_change_requests(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_phone_req_user ON phone_change_requests(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_batches_session ON merchant_batches(session_id);
    CREATE INDEX IF NOT EXISTS idx_orders_session ON orders(session_id);
    CREATE INDEX IF NOT EXISTS idx_orders_batch ON orders(batch_id);
    CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
    CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
  `);
}

function migrateUsersRoleForAdmin(db: DatabaseSync) {
  const tableDef = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'")
    .get() as { sql?: string } | undefined;

  if (tableDef?.sql && !tableDef.sql.includes("'ADMIN'")) {
    db.exec("PRAGMA foreign_keys = OFF;");
    db.exec("BEGIN IMMEDIATE;");
    try {
      db.exec(`
        CREATE TABLE users_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          username TEXT NOT NULL UNIQUE,
          division TEXT NOT NULL DEFAULT '',
          whatsapp TEXT NOT NULL DEFAULT '',
          role TEXT NOT NULL CHECK(role IN ('EMPLOYEE', 'OB', 'ADMIN')) DEFAULT 'EMPLOYEE',
          pin_hash TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO users_new (id, name, username, division, whatsapp, role, pin_hash, created_at)
        SELECT id, name, username, division, whatsapp, role, pin_hash, created_at FROM users;
        DROP TABLE users;
        ALTER TABLE users_new RENAME TO users;
      `);
      db.exec("COMMIT;");
    } catch (err) {
      try {
        db.exec("ROLLBACK;");
      } catch {}
      throw err;
    } finally {
      db.exec("PRAGMA foreign_keys = ON;");
    }
  }
}

function ensureAdminAccount(db: DatabaseSync) {
  // Rename seeded legacy OB labels to Driver
  db.prepare(
    `UPDATE users
     SET name = replace(name, '(OB ', '(Driver '),
         division = CASE WHEN division = 'OB / Driver' THEN 'Driver' ELSE division END
     WHERE role = 'OB' AND (name LIKE '%(OB %' OR division = 'OB / Driver')`
  ).run();

  const adminRow = db
    .prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'ADMIN'")
    .get() as { count: number };
  if (adminRow.count > 0) return;

  const existingUsername = db
    .prepare("SELECT id FROM users WHERE lower(username) = 'admin'")
    .get();
  const username = existingUsername ? "superadmin" : "admin";

  db.prepare(
    "INSERT INTO users (name, username, division, whatsapp, role, pin_hash) VALUES (?, ?, ?, ?, 'ADMIN', ?)"
  ).run("Super Admin", username, "Office Ops", "", hashPin("1234"));
}

function seedInitialData(db: DatabaseSync) {
  const row = db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
  if (row.count > 0) {
    ensureAdminAccount(db);
    return;
  }

  const defaultPinHash = hashPin("1234");
  const insertUser = db.prepare(
    "INSERT INTO users (name, username, division, whatsapp, role, pin_hash) VALUES (?, ?, ?, ?, ?, ?)"
  );

  insertUser.run("Super Admin", "admin", "Office Ops", "", "ADMIN", defaultPinHash);

  const insertMerchant = db.prepare(
    "INSERT INTO merchants (name, category, location_note) VALUES (?, ?, ?)"
  );
  const insertMenu = db.prepare(
    "INSERT INTO menu_items (merchant_id, name, estimated_price) VALUES (?, ?, ?)"
  );

  const catalog: Array<{
    name: string;
    category: string;
    location: string;
    menus: Array<[string, number]>;
  }> = [
    {
      name: "RM Padang Sederhana",
      category: "Makanan",
      location: "Seberang gedung kantor",
      menus: [
        ["Nasi Rendang + Sayur", 25000],
        ["Nasi Ayam Pop", 22000],
        ["Nasi Ayam Bakar", 22000],
        ["Nasi Telur Dadar", 16000],
        ["Es Teh Manis", 5000],
      ],
    },
    {
      name: "Warteg Bahari",
      category: "Makanan",
      location: "Gang sebelah parkiran",
      menus: [
        ["Nasi + Orek + Telur Balado", 15000],
        ["Nasi + Tongkol + Sayur Sop", 18000],
        ["Nasi + Ayam Goreng + Tumis", 20000],
        ["Gorengan (Bakwan/Tempe)", 2000],
      ],
    },
    {
      name: "Ayam Geprek Mas Eko",
      category: "Makanan",
      location: "Depan halte utama",
      menus: [
        ["Paket Geprek Original + Nasi", 20000],
        ["Paket Geprek Keju + Nasi", 24000],
        ["Indomie Geprek", 19000],
        ["Es Jeruk Peras", 7000],
      ],
    },
    {
      name: "Kopi & Es Teh Kantor",
      category: "Minuman",
      location: "Ruko deretan depan",
      menus: [
        ["Es Kopi Susu Gula Aren", 18000],
        ["Iced Americano", 15000],
        ["Matcha Latte Iced", 22000],
        ["Es Teh Manis Jumbo", 6000],
      ],
    },
    {
      name: "Indomaret / Alfamart",
      category: "Minimarket",
      location: "Jalan raya depan",
      menus: [
        ["Air Mineral 600ml", 4000],
        ["Roti Sari Roti", 8000],
        ["Tolak Angin Sachet", 5000],
        ["Tisu Wajah Travel Pack", 9000],
      ],
    },
  ];

  for (const m of catalog) {
    const res = insertMerchant.run(m.name, m.category, m.location);
    const merchantId = Number(res.lastInsertRowid);
    for (const [menuName, price] of m.menus) {
      insertMenu.run(merchantId, menuName, price);
    }
  }
}

function migrateOrdersMaxBudget(db: DatabaseSync) {
  const cols = db
    .prepare("PRAGMA table_info(orders)")
    .all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "max_budget")) {
    db.exec("ALTER TABLE orders ADD COLUMN max_budget INTEGER DEFAULT NULL;");
  }
}

export function getDb(): DatabaseSync {
  if (!globalThis.__abangkuhDb) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    globalThis.__abangkuhDb = new DatabaseSync(DB_PATH);
  }
  if (globalThis.__abangkuhSchemaVersion !== SCHEMA_VERSION) {
    createSchema(globalThis.__abangkuhDb);
    migrateUsersRoleForAdmin(globalThis.__abangkuhDb);
    migrateOrdersMaxBudget(globalThis.__abangkuhDb);
    seedInitialData(globalThis.__abangkuhDb);
    globalThis.__abangkuhSchemaVersion = SCHEMA_VERSION;
  }
  return globalThis.__abangkuhDb;
}

export function withTransaction<T>(fn: (db: DatabaseSync) => T): T {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn(db);
    db.exec("COMMIT");
    return result;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Ignore rollback error if transaction already closed
    }
    throw err;
  }
}

export function ensureTodaySessions(): OrderSession[] {
  const db = getDb();
  const { date } = getJakartaNow();

  const insertSession = db.prepare(`
    INSERT OR IGNORE INTO order_sessions (session_date, slot, label, open_time, close_time, status)
    VALUES (?, ?, ?, ?, ?, 'OPEN')
  `);

  insertSession.run(date, "SIANG", "Sesi Siang (10:00 - 10:30)", "10:00", "10:30");
  insertSession.run(date, "SORE", "Sesi Sore (15:00 - 16:00)", "15:00", "16:00");

  const rows = db
    .prepare(
      `
      SELECT
        s.*,
        (SELECT COUNT(*) FROM orders o WHERE o.session_id = s.id AND o.payment_status != 'CANCELLED') AS order_count,
        (SELECT COUNT(*) FROM merchant_batches b WHERE b.session_id = s.id) AS batch_count
      FROM order_sessions s
      WHERE s.session_date = ?
      ORDER BY CASE s.slot WHEN 'SIANG' THEN 1 ELSE 2 END
      `
    )
    .all(date) as unknown as OrderSession[];

  return rows.map((s) => {
    const within = isWithinSessionSchedule(s.open_time, s.close_time);
    return {
      ...s,
      is_within_schedule: within,
      can_order: s.status === "OPEN",
    };
  });
}
