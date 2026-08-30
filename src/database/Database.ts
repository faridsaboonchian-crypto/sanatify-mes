import * as SQLite from 'expo-sqlite';

const DATABASE_NAME = 'sanatify.db';
const TARGET_DB_VERSION = 15;

export let dbInstance: SQLite.SQLiteDatabase | null = null;

export function generateUniqueId(prefix: string = 'id'): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${prefix}-${timestamp}-${random}`;
}

// ✅ FIX: تلاش مجدد برای باز کردن دیتابیس (حل خطای Property 'db' doesn't exist در نسخه نصبی)
export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (dbInstance) {
    return dbInstance;
  }
  const attempts = 4;
  let lastError: any = null;
  for (let i = 0; i < attempts; i++) {
    try {
      console.log(`[SQLite Connection] Attempt ${i + 1}/${attempts} to open "${DATABASE_NAME}"...`);
      dbInstance = await SQLite.openDatabaseAsync(DATABASE_NAME);
      if (dbInstance) {
        console.log('[SQLite Connection] Database instance ready.');
        return dbInstance;
      }
    } catch (e: any) {
      lastError = e;
      console.warn(`[SQLite Connection] Attempt ${i + 1} failed:`, e?.message || e);
      await new Promise((resolve) => setTimeout(resolve, 250 * (i + 1)));
    }
  }
  console.error('[SQLite Connection ERROR] Could not open database after retries:', lastError);
  throw lastError || new Error('عدم امکان باز کردن دیتابیس پس از چند بار تلاش.');
}

async function safeAddColumn(
  db: SQLite.SQLiteDatabase,
  tableName: string,
  columnName: string,
  columnType: string
): Promise<void> {
  try {
    const tableInfo = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${tableName});`);
    const columnExists = tableInfo.some(column => column.name === columnName);
    if (!columnExists) {
      // [SAFE_ADD_COLUMN_V2_HARDENED] حذف پیش‌فرض غیرثابت (CURRENT_TIMESTAMP) قبل از ALTER
      // چون SQLite در ADD COLUMN مقدار غیرثابت را رد می‌کند. مقدار بعداً توسط backfill پر می‌شود.
      let safeType = columnType;
      const upperType = safeType.toUpperCase();
      if (
        upperType.indexOf('CURRENT_TIMESTAMP') !== -1 ||
        upperType.indexOf('CURRENT_DATE') !== -1 ||
        upperType.indexOf('CURRENT_TIME') !== -1
      ) {
        safeType = safeType.replace(/NOT\s+NULL/gi, '');
        const defaultIndex = safeType.toUpperCase().indexOf('DEFAULT');
        if (defaultIndex !== -1) {
          safeType = safeType.substring(0, defaultIndex);
        }
        safeType = safeType.trim();
      }
      console.log(`[SQLite Migration] Adding column "${columnName}" to "${tableName}" as [${safeType}]`);
      await db.execAsync(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${safeType};`);
    }
  } catch (e) {
    console.warn(`[SQLite Migration WARNING] Column "${columnName}" on "${tableName}":`, e);
  }
}

// ✅ FIX: درج machines از اینجا حذف شد (جدولش در V2 ساخته می‌شود)
async function runVersion1Migration(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS shifts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      planned_duration_minutes INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS operators (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      personnel_code TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      active_shift_id TEXT,
      FOREIGN KEY (active_shift_id) REFERENCES shifts (id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      ideal_cycle_time_seconds REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS production_logs (
      id TEXT PRIMARY KEY,
      operator_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      shift_id TEXT NOT NULL,
      good_quantity INTEGER NOT NULL,
      timestamp TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      sync_status TEXT DEFAULT 'pending',
      machine_id TEXT,
      job_id TEXT,
      line_id TEXT,
      workshop_id TEXT,
      target_id TEXT,
      remote_id TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (operator_id) REFERENCES operators (id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE,
      FOREIGN KEY (shift_id) REFERENCES shifts (id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS waste_logs (
      id TEXT PRIMARY KEY,
      shift_id TEXT NOT NULL,
      reason_id TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      timestamp TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      sync_status TEXT DEFAULT 'pending',
      machine_id TEXT,
      job_id TEXT,
      operator_id TEXT,
      remote_id TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (shift_id) REFERENCES shifts (id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS downtime_logs (
      id TEXT PRIMARY KEY,
      shift_id TEXT NOT NULL,
      reason_id TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT,
      duration_minutes INTEGER,
      timestamp TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      sync_status TEXT DEFAULT 'pending',
      machine_id TEXT,
      is_unplanned INTEGER DEFAULT 1,
      remote_id TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (shift_id) REFERENCES shifts (id) ON DELETE CASCADE
    );
  `);
  await db.execAsync(`
    INSERT OR IGNORE INTO operators (id, name, personnel_code, password, role, active_shift_id) VALUES
    ('op-vahid-1001', 'وحید کریمی', '1001', '1234', 'operator', NULL),
    ('op-ali-1002', 'علی محمدی', '1002', '1234', 'operator', NULL),
    ('op-reza-1003', 'مهندس رضا اکبری', '1003', '5678', 'manager', NULL),
    ('op-saeed-1004', 'مهندس سعید علوی', '1004', '1234', 'engineer', NULL);
  `);
}

async function runVersion2Migration(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS machines (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      remote_id TEXT,
      sync_status TEXT DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    );
    CREATE TABLE IF NOT EXISTS production_orders (
      id TEXT PRIMARY KEY,
      order_number TEXT UNIQUE NOT NULL,
      target_quantity INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      remote_id TEXT,
      sync_status TEXT DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    );
    CREATE TABLE IF NOT EXISTS production_jobs (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      machine_id TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      remote_id TEXT,
      sync_status TEXT DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT,
      FOREIGN KEY (order_id) REFERENCES production_orders (id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE,
      FOREIGN KEY (machine_id) REFERENCES machines (id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS warehouses (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      remote_id TEXT,
      sync_status TEXT DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    );
    CREATE TABLE IF NOT EXISTS inventory_items (
      id TEXT PRIMARY KEY,
      warehouse_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 0.0,
      remote_id TEXT,
      sync_status TEXT DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT,
      FOREIGN KEY (warehouse_id) REFERENCES warehouses (id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE,
      UNIQUE(warehouse_id, product_id)
    );
    CREATE TABLE IF NOT EXISTS bill_of_materials (
      id TEXT PRIMARY KEY,
      parent_product_id TEXT NOT NULL,
      child_product_id TEXT NOT NULL,
      quantity_required REAL NOT NULL,
      remote_id TEXT,
      sync_status TEXT DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT,
      FOREIGN KEY (parent_product_id) REFERENCES products (id) ON DELETE CASCADE,
      FOREIGN KEY (child_product_id) REFERENCES products (id) ON DELETE CASCADE
    );
  `);
  await db.execAsync(`
    INSERT OR IGNORE INTO machines (id, name, code) VALUES
    ('mach-press-01', 'دستگاه پرس هیدرولیک بزرگ', 'PR-01'),
    ('mach-weld-02', 'دستگاه جوش رباتیک فاز ۲', 'WD-02');
    INSERT OR IGNORE INTO warehouses (id, name, code) VALUES
    ('wh-raw-101', 'انبار مواد اولیه ورق آهنی', 'WH-RAW'),
    ('wh-line-102', 'انبار موقت خط پرس شماره ۳', 'WH-LINE');
    INSERT OR IGNORE INTO products (id, name, ideal_cycle_time_seconds) VALUES
    ('raw-sheet-steel', 'ورق آهنی خام رول شده', 0.0);
    INSERT OR IGNORE INTO inventory_items (id, warehouse_id, product_id, quantity) VALUES
    ('inv-item-001', 'wh-line-102', 'raw-sheet-steel', 5000.0);
    INSERT OR IGNORE INTO bill_of_materials (id, parent_product_id, child_product_id, quantity_required) VALUES
    ('bom-sheet-to-partA', 'prod-a-201', 'raw-sheet-steel', 1.2);
  `);
}

async function runVersion3Migration(db: SQLite.SQLiteDatabase): Promise<void> {
  await safeAddColumn(db, 'downtime_logs', 'is_unplanned', 'INTEGER DEFAULT 1');
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS maintenance_events (
      id TEXT PRIMARY KEY,
      machine_id TEXT NOT NULL,
      operator_id TEXT NOT NULL,
      description TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT,
      cost REAL DEFAULT 0.0,
      sync_status TEXT DEFAULT 'pending',
      remote_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT,
      FOREIGN KEY (machine_id) REFERENCES machines (id) ON DELETE CASCADE,
      FOREIGN KEY (operator_id) REFERENCES operators (id) ON DELETE CASCADE
    );
  `);
}

async function runVersion4Migration(db: SQLite.SQLiteDatabase): Promise<void> {
  await safeAddColumn(db, 'production_orders', 'priority', 'INTEGER DEFAULT 3');
  await db.execAsync(`
    INSERT OR IGNORE INTO production_orders (id, order_number, target_quantity, status, priority) VALUES
    ('order-priority-mock', 'PO-2026-BOM-WARN', 4000, 'pending', 5);
  `);
}

async function runVersion5Migration(db: SQLite.SQLiteDatabase): Promise<void> {
  await safeAddColumn(db, 'waste_logs', 'operator_id', 'TEXT');
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS workshop_contexts (
      id TEXT PRIMARY KEY,
      workshop_name TEXT NOT NULL,
      line_name TEXT NOT NULL,
      machine_name TEXT NOT NULL,
      assigned_supervisor TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await db.execAsync(`
    INSERT OR IGNORE INTO workshop_contexts (id, workshop_name, line_name, machine_name, assigned_supervisor) VALUES
    ('ctx-press-01', 'پرس', 'خط پرس شماره ۳', 'دستگاه پرس هیدرولیک بزرگ', 'مهندس رضا اکبری'),
    ('ctx-weld-02', 'جوشکاری', 'خط جوش رباتیک فاز ۲', 'دستگاه جوش رباتیک', 'مهندس رضا اکبری');
    INSERT OR IGNORE INTO meta (key, value) VALUES ('active_workshop_context_id', 'ctx-press-01');
  `);
}

async function runVersion6Migration(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS industrial_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      operator_id TEXT,
      operator_name TEXT,
      workshop_id TEXT,
      workshop_name TEXT,
      line_id TEXT,
      line_name TEXT,
      machine_id TEXT,
      machine_name TEXT,
      shift_id TEXT,
      payload_json TEXT,
      sync_status TEXT DEFAULT 'pending',
      source_module TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

async function runVersion7Migration(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS workshops (
      id TEXT PRIMARY KEY,
      workshop_code TEXT UNIQUE NOT NULL,
      workshop_name TEXT NOT NULL,
      description TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS production_lines (
      id TEXT PRIMARY KEY,
      workshop_id TEXT,
      line_name TEXT NOT NULL,
      line_code TEXT UNIQUE NOT NULL,
      is_active INTEGER DEFAULT 1,
      FOREIGN KEY(workshop_id) REFERENCES workshops(id) ON DELETE CASCADE
    );
  `);
  await safeAddColumn(db, 'machines', 'workshop_id', 'TEXT');
  await safeAddColumn(db, 'machines', 'line_id', 'TEXT');
  await safeAddColumn(db, 'machines', 'machine_group_id', 'TEXT');
  await safeAddColumn(db, 'machines', 'status', "TEXT DEFAULT 'running'");
  await safeAddColumn(db, 'machines', 'ideal_cycle_time', 'REAL');
  await safeAddColumn(db, 'machines', 'is_active', 'INTEGER DEFAULT 1');
  await safeAddColumn(db, 'products', 'product_code', 'TEXT');
  await safeAddColumn(db, 'products', 'unit', "TEXT DEFAULT 'pcs'");
  await safeAddColumn(db, 'products', 'is_active', 'INTEGER DEFAULT 1');
  await safeAddColumn(db, 'products', 'category', "TEXT DEFAULT 'finished_good'");
  await safeAddColumn(db, 'shifts', 'start_time', 'TEXT');
  await safeAddColumn(db, 'shifts', 'end_time', 'TEXT');
  await safeAddColumn(db, 'shifts', 'is_night_shift', 'INTEGER DEFAULT 0');
  await safeAddColumn(db, 'shifts', 'is_active', 'INTEGER DEFAULT 1');
  await safeAddColumn(db, 'operators', 'machine_id', 'TEXT');
  await safeAddColumn(db, 'operators', 'line_id', 'TEXT');
  await safeAddColumn(db, 'operators', 'workshop_id', 'TEXT');
  await safeAddColumn(db, 'production_logs', 'line_id', 'TEXT');
  await safeAddColumn(db, 'production_logs', 'workshop_id', 'TEXT');
  await safeAddColumn(db, 'production_logs', 'target_id', 'TEXT');
  await db.execAsync(`
    INSERT OR IGNORE INTO workshops (id, workshop_code, workshop_name, description) VALUES
    ('ws-press', 'WS-PR', 'پرس‌کاری فلزات', 'سالن ماشین‌آلات پرس سبک و سنگین ورق'),
    ('ws-weld', 'WS-WD', 'جوشکاری رباتیک', 'سالن اتصالات و مونتاژ بدنه فلزی');
    INSERT OR IGNORE INTO production_lines (id, workshop_id, line_name, line_code) VALUES
    ('line-press-03', 'ws-press', 'خط پرس شماره ۳', 'L-PR3'),
    ('line-weld-02', 'ws-weld', 'خط جوش رباتیک فاز ۲', 'L-WD2');
  `);
  await db.execAsync(`
    UPDATE machines SET workshop_id = 'ws-press', line_id = 'line-press-03', status = 'running', ideal_cycle_time = 15.0, is_active = 1 WHERE id = 'mach-press-01';
    UPDATE machines SET workshop_id = 'ws-weld', line_id = 'line-weld-02', status = 'running', ideal_cycle_time = 30.0, is_active = 1 WHERE id = 'mach-weld-02';
  `);
  await db.execAsync(`
    UPDATE products SET category = 'raw_material' WHERE id = 'raw-sheet-steel';
  `);
  await db.execAsync(`
    UPDATE operators SET workshop_id = 'ws-press', line_id = 'line-press-03', machine_id = 'mach-press-01' WHERE id = 'op-vahid-1001';
    UPDATE operators SET workshop_id = 'ws-weld', line_id = 'line-weld-02', machine_id = 'mach-weld-02' WHERE id = 'op-ali-1002';
  `);
}

async function runVersion8Migration(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS production_targets (
      id TEXT PRIMARY KEY,
      target_quantity INTEGER NOT NULL,
      target_date TEXT NOT NULL,
      target_shift_id TEXT NOT NULL,
      target_machine_id TEXT NOT NULL,
      target_line_id TEXT NOT NULL,
      target_workshop_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      created_by TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      sync_status TEXT DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (target_shift_id) REFERENCES shifts (id),
      FOREIGN KEY (target_machine_id) REFERENCES machines (id),
      FOREIGN KEY (target_line_id) REFERENCES production_lines (id),
      FOREIGN KEY (target_workshop_id) REFERENCES workshops (id),
      FOREIGN KEY (product_id) REFERENCES products (id)
    );
  `);
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS job_assignments (
      id TEXT PRIMARY KEY,
      operator_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      assigned_at TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      FOREIGN KEY (operator_id) REFERENCES operators (id),
      FOREIGN KEY (target_id) REFERENCES production_targets (id)
    );
  `);
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS schedule_slots (
      id TEXT PRIMARY KEY,
      shift_id TEXT NOT NULL,
      slot_date TEXT NOT NULL,
      capacity_hours REAL NOT NULL,
      is_available INTEGER DEFAULT 1,
      FOREIGN KEY (shift_id) REFERENCES shifts (id)
    );
  `);
  await db.execAsync(`
    INSERT OR IGNORE INTO production_targets (
      id, target_quantity, target_date, target_shift_id, target_machine_id,
      target_line_id, target_workshop_id, product_id, created_by, status
    ) VALUES (
      'tgt-active-mock-01', 3500, '2026-05-25', 'shift-morning-301', 'mach-press-01',
      'line-press-03', 'ws-press', 'prod-a-201', 'op-reza-1003', 'active'
    );
    INSERT OR IGNORE INTO job_assignments (id, operator_id, target_id, assigned_at, status) VALUES
    ('assign-mock-01', 'op-vahid-1001', 'tgt-active-mock-01', '2026-05-25T07:00:00Z', 'active');
  `);
}

async function runVersion10Migration(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS inventory_transactions (
      id TEXT PRIMARY KEY,
      warehouse_id TEXT,
      line_id TEXT,
      product_id TEXT NOT NULL,
      transaction_type TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit TEXT NOT NULL,
      reference_type TEXT NOT NULL,
      reference_id TEXT,
      operator_id TEXT,
      note TEXT,
      sync_status TEXT DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
      FOREIGN KEY (line_id) REFERENCES production_lines(id),
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (operator_id) REFERENCES operators(id)
    );
    CREATE TABLE IF NOT EXISTS material_reservations (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
    CREATE TABLE IF NOT EXISTS stock_alerts (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      warehouse_id TEXT,
      alert_type TEXT NOT NULL,
      message TEXT NOT NULL,
      is_resolved INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
  `);
}

async function runVersion11Migration(db: SQLite.SQLiteDatabase): Promise<void> {
  await safeAddColumn(db, 'production_logs', 'remote_id', 'TEXT');
  await safeAddColumn(db, 'production_logs', 'created_at', 'TEXT');
  await safeAddColumn(db, 'production_logs', 'updated_at', 'TEXT');
  await safeAddColumn(db, 'production_logs', 'sync_status', "TEXT DEFAULT 'pending'");
  await safeAddColumn(db, 'production_logs', 'machine_id', 'TEXT');
  await safeAddColumn(db, 'production_logs', 'job_id', 'TEXT');
  await safeAddColumn(db, 'production_logs', 'line_id', 'TEXT');
  await safeAddColumn(db, 'production_logs', 'workshop_id', 'TEXT');
  await safeAddColumn(db, 'production_logs', 'target_id', 'TEXT');
  await safeAddColumn(db, 'waste_logs', 'remote_id', 'TEXT');
  await safeAddColumn(db, 'waste_logs', 'created_at', 'TEXT');
  await safeAddColumn(db, 'waste_logs', 'updated_at', 'TEXT');
  await safeAddColumn(db, 'waste_logs', 'sync_status', "TEXT DEFAULT 'pending'");
  await safeAddColumn(db, 'waste_logs', 'machine_id', 'TEXT');
  await safeAddColumn(db, 'waste_logs', 'job_id', 'TEXT');
  await safeAddColumn(db, 'waste_logs', 'operator_id', 'TEXT');
  await safeAddColumn(db, 'downtime_logs', 'remote_id', 'TEXT');
  await safeAddColumn(db, 'downtime_logs', 'created_at', 'TEXT');
  await safeAddColumn(db, 'downtime_logs', 'updated_at', 'TEXT');
  await safeAddColumn(db, 'downtime_logs', 'sync_status', "TEXT DEFAULT 'pending'");
  await safeAddColumn(db, 'downtime_logs', 'machine_id', 'TEXT');
  await safeAddColumn(db, 'downtime_logs', 'is_unplanned', 'INTEGER DEFAULT 1');
  await safeAddColumn(db, 'maintenance_events', 'remote_id', 'TEXT');
  await safeAddColumn(db, 'maintenance_events', 'sync_status', "TEXT DEFAULT 'pending'");
}

async function repairLegacySchemas(db: SQLite.SQLiteDatabase): Promise<void> {
  try {
    await db.execAsync('PRAGMA foreign_keys = OFF;');
    await safeAddColumn(db, 'maintenance_events', 'workshop_id', 'TEXT');
    await safeAddColumn(db, 'maintenance_events', 'downtime_id', 'TEXT');
    await safeAddColumn(db, 'maintenance_events', 'engineer_id', 'TEXT');
    await safeAddColumn(db, 'maintenance_events', 'failure_reason_id', 'TEXT');
    await safeAddColumn(db, 'maintenance_events', 'maintenance_type', 'TEXT');
    await safeAddColumn(db, 'maintenance_events', 'started_at', 'TEXT');
    await safeAddColumn(db, 'maintenance_events', 'completed_at', 'TEXT');
    await safeAddColumn(db, 'maintenance_events', 'repair_minutes', 'INTEGER');
    await safeAddColumn(db, 'maintenance_events', 'status', "TEXT DEFAULT 'open'");
    await db.execAsync(`
CREATE TABLE IF NOT EXISTS stock_alerts (
id TEXT PRIMARY KEY,
product_id TEXT NOT NULL,
warehouse_id TEXT,
alert_type TEXT NOT NULL,
message TEXT NOT NULL,
is_resolved INTEGER DEFAULT 0,
created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
FOREIGN KEY (product_id) REFERENCES products(id)
);
CREATE TABLE IF NOT EXISTS inventory_transactions (
id TEXT PRIMARY KEY,
warehouse_id TEXT,
line_id TEXT,
product_id TEXT NOT NULL,
transaction_type TEXT NOT NULL,
quantity REAL NOT NULL,
unit TEXT NOT NULL,
reference_type TEXT NOT NULL,
reference_id TEXT,
operator_id TEXT,
note TEXT,
sync_status TEXT DEFAULT 'pending',
created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
FOREIGN KEY (line_id) REFERENCES production_lines(id),
FOREIGN KEY (product_id) REFERENCES products(id),
FOREIGN KEY (operator_id) REFERENCES operators(id)
);
`);
    await db.execAsync(`
CREATE TABLE IF NOT EXISTS quality_inspections (
id TEXT PRIMARY KEY,
billet_id TEXT,
rebar_size TEXT,
measured_diameter REAL,
cross_section_area REAL,
yield_strength REAL,
tensile_strength REAL,
max_load_kgf REAL,
elongation_percent REAL,
bend_test_passed INTEGER,
visual_inspection TEXT,
inspector_id TEXT,
timestamp TEXT NOT NULL,
sync_status TEXT DEFAULT 'pending',
created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS grade_specs (
grade TEXT PRIMARY KEY,
min_yield_mpa REAL NOT NULL,
min_tensile_mpa REAL NOT NULL,
min_elongation_pct REAL NOT NULL,
notes TEXT
);
`);
    await safeAddColumn(db, 'quality_inspections', 'measured_diameter', 'REAL');
    await safeAddColumn(db, 'quality_inspections', 'cross_section_area', 'REAL');
    await safeAddColumn(db, 'quality_inspections', 'max_load_kgf', 'REAL');
    await safeAddColumn(db, 'quality_inspections', 'heat_number', 'TEXT');
    await safeAddColumn(db, 'quality_inspections', 'batch_number', 'TEXT');
    await safeAddColumn(db, 'quality_inspections', 'yield_ratio', 'REAL');
    await safeAddColumn(db, 'quality_inspections', 'standard_compliant', 'INTEGER');
    await safeAddColumn(db, 'quality_inspections', 'workshop_name', 'TEXT');
    await safeAddColumn(db, 'quality_inspections', 'line_name', 'TEXT');
    await safeAddColumn(db, 'quality_inspections', 'machine_name', 'TEXT');
    await safeAddColumn(db, 'quality_inspections', 'inspector_name', 'TEXT');
    await db.execAsync(`
INSERT OR IGNORE INTO grade_specs (grade, min_yield_mpa, min_tensile_mpa, min_elongation_pct, notes) VALUES
('A3', 400, 600, 16, 'استاندارد ملی ایران ISIRI 3132 - میلگرد آج‌دار');
`);
    const tableInfo = await db.getAllAsync<{ name: string }>("PRAGMA table_info(operators);");
    if (tableInfo.length === 0) {
      await db.execAsync('PRAGMA foreign_keys = ON;');
      return;
    }
    const existingColumns = tableInfo.map(column => column.name);
    await safeAddColumn(db, 'operators', 'sync_status', "TEXT DEFAULT 'pending'");
    await safeAddColumn(db, 'shifts', 'sync_status', "TEXT DEFAULT 'pending'");
    await safeAddColumn(db, 'products', 'sync_status', "TEXT DEFAULT 'pending'");
    // ✅ FIX حیاتی: ستون‌هایی که backfillAuditFields آپدیت می‌کند ولی هیچ‌جا ساخته نمی‌شدند.
    // بدون این‌ها backfill با «no such column» می‌ترکد و repairOperatorsSeed هرگز اجرا نمی‌شود.
    await safeAddColumn(db, 'shifts', 'created_at', 'TEXT');
    await safeAddColumn(db, 'shifts', 'updated_at', 'TEXT');
    await safeAddColumn(db, 'products', 'created_at', 'TEXT');
    await safeAddColumn(db, 'products', 'updated_at', 'TEXT');
    await safeAddColumn(db, 'products', 'category', "TEXT DEFAULT 'finished_good'");
    await safeAddColumn(db, 'production_logs', 'sync_status', "TEXT DEFAULT 'pending'");
    await safeAddColumn(db, 'production_logs', 'remote_id', 'TEXT');
    await safeAddColumn(db, 'production_logs', 'created_at', 'TEXT');
    await safeAddColumn(db, 'production_logs', 'updated_at', 'TEXT');
    await safeAddColumn(db, 'production_logs', 'machine_id', 'TEXT');
    await safeAddColumn(db, 'production_logs', 'job_id', 'TEXT');
    await safeAddColumn(db, 'production_logs', 'line_id', 'TEXT');
    await safeAddColumn(db, 'production_logs', 'workshop_id', 'TEXT');
    await safeAddColumn(db, 'production_logs', 'target_id', 'TEXT');
    await safeAddColumn(db, 'waste_logs', 'sync_status', "TEXT DEFAULT 'pending'");
    await safeAddColumn(db, 'waste_logs', 'remote_id', 'TEXT');
    await safeAddColumn(db, 'waste_logs', 'created_at', 'TEXT');
    await safeAddColumn(db, 'waste_logs', 'updated_at', 'TEXT');
    await safeAddColumn(db, 'waste_logs', 'machine_id', 'TEXT');
    await safeAddColumn(db, 'waste_logs', 'job_id', 'TEXT');
    await safeAddColumn(db, 'waste_logs', 'operator_id', 'TEXT');
    await safeAddColumn(db, 'downtime_logs', 'sync_status', "TEXT DEFAULT 'pending'");
    await safeAddColumn(db, 'downtime_logs', 'remote_id', 'TEXT');
    await safeAddColumn(db, 'downtime_logs', 'created_at', 'TEXT');
    await safeAddColumn(db, 'downtime_logs', 'updated_at', 'TEXT');
    await safeAddColumn(db, 'downtime_logs', 'machine_id', 'TEXT');
    await safeAddColumn(db, 'downtime_logs', 'is_unplanned', 'INTEGER DEFAULT 1');
    await safeAddColumn(db, 'maintenance_events', 'remote_id', 'TEXT');
    await safeAddColumn(db, 'maintenance_events', 'sync_status', "TEXT DEFAULT 'pending'");
    if (!existingColumns.includes('password')) {
      await db.execAsync("ALTER TABLE operators ADD COLUMN password TEXT NOT NULL DEFAULT '1234';");
    }
    if (!existingColumns.includes('role')) {
      await db.execAsync("ALTER TABLE operators ADD COLUMN role TEXT NOT NULL DEFAULT 'operator';");
    }
    if (!existingColumns.includes('active_shift_id')) {
      await db.execAsync("ALTER TABLE operators ADD COLUMN active_shift_id TEXT;");
    }
    if (!existingColumns.includes('remote_id')) {
      await db.execAsync("ALTER TABLE operators ADD COLUMN remote_id TEXT;");
    }
    if (!existingColumns.includes('created_at')) {
      await db.execAsync("ALTER TABLE operators ADD COLUMN created_at TEXT;");
    }
    if (!existingColumns.includes('updated_at')) {
      await db.execAsync("ALTER TABLE operators ADD COLUMN updated_at TEXT;");
    }
    if (!existingColumns.includes('deleted_at')) {
      await db.execAsync("ALTER TABLE operators ADD COLUMN deleted_at TEXT;");
    }
    await db.execAsync('PRAGMA foreign_keys = ON;');
  } catch (error) {
    await db.execAsync('PRAGMA foreign_keys = ON;');
    throw error;
  }
}

async function backfillAuditFields(db: SQLite.SQLiteDatabase): Promise<void> {
  try {
    const currentTimestamp = new Date().toISOString();
    await db.runAsync(`UPDATE shifts SET created_at = COALESCE(created_at, ?), updated_at = COALESCE(updated_at, ?), sync_status = COALESCE(sync_status, 'pending') WHERE created_at IS NULL`, [currentTimestamp, currentTimestamp]);
    await db.runAsync(`UPDATE operators SET created_at = COALESCE(created_at, ?), updated_at = COALESCE(updated_at, ?), password = COALESCE(password, '1234'), role = COALESCE(role, 'operator'), sync_status = COALESCE(sync_status, 'pending') WHERE created_at IS NULL`, [currentTimestamp, currentTimestamp]);
    await db.runAsync(`UPDATE products SET created_at = COALESCE(created_at, ?), updated_at = COALESCE(updated_at, ?), category = COALESCE(category, 'finished_good'), sync_status = COALESCE(sync_status, 'pending') WHERE created_at IS NULL`, [currentTimestamp, currentTimestamp]);
    await db.runAsync(`UPDATE production_logs SET created_at = COALESCE(created_at, ?), updated_at = COALESCE(updated_at, ?) WHERE created_at IS NULL`, [currentTimestamp, currentTimestamp]);
    await db.runAsync(`UPDATE waste_logs SET created_at = COALESCE(created_at, ?), updated_at = COALESCE(updated_at, ?) WHERE created_at IS NULL`, [currentTimestamp, currentTimestamp]);
    await db.runAsync(`UPDATE downtime_logs SET created_at = COALESCE(created_at, ?), updated_at = COALESCE(updated_at, ?) WHERE created_at IS NULL`, [currentTimestamp, currentTimestamp]);
  } catch (e) {
    throw e;
  }
}

// ✅ FIX: شیفت‌ها و محصولات مرجع هم seed می‌شوند (حل خطاهای FOREIGN KEY)
async function repairOperatorsSeed(db: SQLite.SQLiteDatabase): Promise<void> {
  try {
    await db.execAsync('PRAGMA foreign_keys = OFF;');
    await db.runAsync(`INSERT OR IGNORE INTO shifts (id, name, planned_duration_minutes) VALUES (?, ?, ?);`, ['shift-morning-301', 'شیفت صبح', 480]);
    await db.runAsync(`INSERT OR IGNORE INTO shifts (id, name, planned_duration_minutes) VALUES (?, ?, ?);`, ['shift-night-302', 'شیفت شب', 480]);
    await db.runAsync(`INSERT OR IGNORE INTO products (id, name, ideal_cycle_time_seconds) VALUES (?, ?, ?);`, ['prod-a-201', 'میلگرد آج‌دار سایز 16', 15.0]);
    await db.runAsync(`INSERT OR IGNORE INTO products (id, name, ideal_cycle_time_seconds) VALUES (?, ?, ?);`, ['raw-sheet-steel', 'ورق آهنی خام رول شده', 0.0]);
    await db.runAsync(`INSERT OR REPLACE INTO machines (id, name, code) VALUES (?, ?, ?);`, ['mach-press-01', 'دستگاه پرس هیدرولیک بزرگ', 'PR-01']);
    await db.runAsync(`INSERT OR REPLACE INTO machines (id, name, code) VALUES (?, ?, ?);`, ['mach-weld-02', 'دستگاه جوش رباتیک فاز ۲', 'WD-02']);
    await db.runAsync(`INSERT OR REPLACE INTO operators (id, name, personnel_code, password, role, active_shift_id) VALUES (?, ?, ?, ?, ?, ?);`, ['op-vahid-1001', 'وحید کریمی', '1001', '1234', 'operator', null]);
    await db.runAsync(`INSERT OR REPLACE INTO operators (id, name, personnel_code, password, role, active_shift_id) VALUES (?, ?, ?, ?, ?, ?);`, ['op-ali-1002', 'علی محمدی', '1002', '1234', 'operator', null]);
    await db.runAsync(`INSERT OR REPLACE INTO operators (id, name, personnel_code, password, role, active_shift_id) VALUES (?, ?, ?, ?, ?, ?);`, ['op-reza-1003', 'مهندس رضا اکبری', '1003', '5678', 'manager', null]);
    await db.runAsync(`INSERT OR REPLACE INTO operators (id, name, personnel_code, password, role, active_shift_id) VALUES (?, ?, ?, ?, ?, ?);`, ['op-saeed-1004', 'مهندس سعید علوی', '1004', '1234', 'engineer', null]);
    // ✅ ADDITIVE — کارشناس انبار و لجستیک (نقش جدید: ردیابی/بسته‌بندی/بارگیری/MTC)
    await db.runAsync(`INSERT OR REPLACE INTO operators (id, name, personnel_code, password, role, active_shift_id) VALUES (?, ?, ?, ?, ?, ?);`, ['op-warehouse-1005', 'کارشناس انبار', '1005', '1234', 'warehouse', null]);
    await db.execAsync('PRAGMA foreign_keys = ON;');
  } catch (e) {
    await db.execAsync('PRAGMA foreign_keys = ON;').catch(() => { });
    console.warn('Seed warning:', e);
  }
}

// ✅ ADDITIVE — پاک‌سازی داده‌های عملیاتی (تولید/ضایعات/توقف/QC/شمش/کوره/بندیل)
// داده‌های مرجع (پرسنل/شیفت/محصول/دستگاه/سالن) دست‌نخورده می‌مانند.
// ترتیب DELETE به‌خاطر کلید خارجی: اول فرزندانِ billets پاک می‌شوند.

// ✅ ADDITIVE — E3: درج دادهٔ نمونهٔ زنجیره‌ای کامل (دموی یک‌کلیکی، ایدمپوتنت)
export async function seedDemoChainData(): Promise<Record<string, number>> {
  const db = await getDatabase();
  const iso = (minAgo: number) => new Date(Date.now() - minAgo * 60000).toISOString();
  const H1 = 'KF-1405-01', H2 = 'KF-1405-02';
  await db.execAsync('PRAGMA foreign_keys = OFF;');
  try {
    for (const t of ['rebar_bundles', 'furnace_logs', 'billets', 'quality_inspections', 'downtime_logs', 'waste_logs']) {
      await db.runAsync(`DELETE FROM ${t} WHERE id LIKE 'demo-%';`);
    }
    let nB = 0, nF = 0, nBd = 0, nQ = 0, nD = 0, nW = 0;
    // ذوب ۱: ۱۲ شمش → شارژ کوره → نورد
    for (let i = 1; i <= 12; i++) {
      await db.runAsync(`INSERT OR REPLACE INTO billets (id, heat_number, batch_number, supplier_name, dimensions, length_meters, initial_weight_kg, grade, status, received_at, created_at, updated_at, sync_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'pending');`,
        [`demo-billet-a-${i}`, H1, 'B-4512', 'فولاد کیان', '125x125', 12, 2083, '3SP', 'ROLLED', iso(26 * 60), iso(26 * 60), iso(26 * 60)]);
      nB++;
      await db.runAsync(`INSERT OR REPLACE INTO furnace_logs (id, billet_id, heat_number, charge_time, discharge_time, residence_time_minutes, furnace_temperature_celsius, shift_id, machine_id, created_at, updated_at, sync_status) VALUES (?,?,?,?,?,?,?,?,?,?,?, 'pending');`,
        [`demo-fur-a-${i}`, `demo-billet-a-${i}`, H1, iso(20 * 60), iso(19 * 60), 60, 1100, 'shift-night-302', 'mach-furnace-01', iso(20 * 60), iso(19 * 60)]);
      nF++;
    }
    // ذوب ۱: ۱۲ بندیل (۱۰ تأیید / ۱ مردود / ۱ در انتظار)
    for (let i = 1; i <= 12; i++) {
      const st = i <= 10 ? 'APPROVED' : i === 11 ? 'REJECTED' : 'PENDING';
      await db.runAsync(`INSERT OR REPLACE INTO rebar_bundles (id, bundle_code, heat_number, billet_id, rebar_size, rebar_grade, branch_count, net_weight_kg, quality_status, produced_at, shift_id, workshop_id, created_at, updated_at, sync_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending');`,
        [`demo-bundle-a-${i}`, `BND-DEMO-A-${String(i).padStart(2, '0')}`, H1, `demo-billet-a-${i}`, 16, 'A3', 80, 2050, st, iso(18 * 60), 'shift-night-302', null, iso(18 * 60), iso(18 * 60)]);
      nBd++;
    }
    // QC: یک آزمون مطابق + یک آزمون مردود
    await db.runAsync(`INSERT OR REPLACE INTO quality_inspections (id, billet_id, rebar_size, yield_strength, tensile_strength, elongation_percent, bend_test_passed, visual_inspection, inspector_id, inspector_name, timestamp, heat_number, yield_ratio, standard_compliant, workshop_name, line_name, machine_name, sync_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending');`,
      ['demo-qc-a-1', 'demo-billet-a-1', '16', 450, 650, 18, 1, '1', 'op-saeed-1004', 'مهندس سعید علوی', iso(17 * 60), H1, 1.44, 1, 'نورد', 'خط نورد', 'قفسه ۱']);
    await db.runAsync(`INSERT OR REPLACE INTO quality_inspections (id, billet_id, rebar_size, yield_strength, tensile_strength, elongation_percent, bend_test_passed, visual_inspection, inspector_id, inspector_name, timestamp, heat_number, yield_ratio, standard_compliant, workshop_name, line_name, machine_name, sync_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending');`,
      ['demo-qc-a-2', 'demo-billet-a-11', '16', 380, 570, 14, 0, '0', 'op-saeed-1004', 'مهندس سعید علوی', iso(17 * 60), H1, 1.5, 0, 'نورد', 'خط نورد', 'قفسه ۱']);
    nQ = 2;
    // ذوب ۲: ۶ شمش در حیاط (برای تبِ انبار)
    for (let i = 1; i <= 6; i++) {
      await db.runAsync(`INSERT OR REPLACE INTO billets (id, heat_number, batch_number, supplier_name, dimensions, length_meters, initial_weight_kg, grade, status, received_at, created_at, updated_at, sync_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'pending');`,
        [`demo-billet-b-${i}`, H2, 'B-4513', 'فولاد کیان', '125x125', 12, 2083, '3SP', 'IN_YARD', iso(2 * 60), iso(2 * 60), iso(2 * 60)]);
      nB++;
    }
    // توقفات: ۲ اضطراری بسته + ۱ برنامه‌ریزی
    await db.runAsync(`INSERT OR REPLACE INTO downtime_logs (id, shift_id, reason_id, start_time, end_time, duration_minutes, timestamp, is_unplanned, machine_id, sync_status) VALUES (?,?,?,?,?,?,?,?,?, 'pending');`,
      ['demo-down-1', 'shift-night-302', 'mech_elec', iso(20 * 60), iso(18 * 60), 120, iso(20 * 60), 1, 'mach-stand-02']);
    await db.runAsync(`INSERT OR REPLACE INTO downtime_logs (id, shift_id, reason_id, start_time, end_time, duration_minutes, timestamp, is_unplanned, machine_id, sync_status) VALUES (?,?,?,?,?,?,?,?,?, 'pending');`,
      ['demo-down-2', 'shift-night-302', 'roll_change', iso(16 * 60), iso(15 * 60), 90, iso(16 * 60), 1, 'mach-stand-02']);
    await db.runAsync(`INSERT OR REPLACE INTO downtime_logs (id, shift_id, reason_id, start_time, end_time, duration_minutes, timestamp, is_unplanned, machine_id, sync_status) VALUES (?,?,?,?,?,?,?,?,?, 'pending');`,
      ['demo-down-3', 'shift-night-302', 'shear_adjust', iso(10 * 60), iso(9.5 * 60), 30, iso(10 * 60), 0, 'mach-shear-05']);
    nD = 3;
    // ضایعات قیچی
    await db.runAsync(`INSERT OR REPLACE INTO waste_logs (id, shift_id, reason_id, quantity, timestamp, operator_id, sync_status) VALUES (?,?,?,?,?,?, 'pending');`,
      ['demo-waste-1', 'shift-night-302', 'crop-ends', 4, iso(18 * 60), 'op-vahid-1001']);
    nW = 1;
    await db.execAsync('PRAGMA foreign_keys = ON;');
    return { billets: nB, furnace_logs: nF, rebar_bundles: nBd, quality_inspections: nQ, downtime_logs: nD, waste_logs: nW };
  } catch (e) {
    await db.execAsync('PRAGMA foreign_keys = ON;').catch(() => { });
    throw e;
  }
}
export async function purgeOperationalData(): Promise<Record<string, number>> {
  const db = await getDatabase();
  const tables = [
    'rebar_bundles', 'furnace_logs', 'billets',
    'quality_inspections', 'downtime_logs', 'waste_logs', 'production_logs',
  ];
  const counts: Record<string, number> = {};
  await db.execAsync('PRAGMA foreign_keys = OFF;');
  try {
    for (const t of tables) {
      try {
        const before = await db.getFirstAsync<{ c: number }>(`SELECT COUNT(*) AS c FROM ${t};`);
        await db.execAsync(`DELETE FROM ${t};`);
        counts[t] = before?.c ?? 0;
      } catch (e: any) {
        console.warn(`[purgeOperationalData] ${t}:`, e?.message || e);
        counts[t] = -1;
      }
    }
  } finally {
    await db.execAsync('PRAGMA foreign_keys = ON;');
  }
  return counts;
}
async function runVersion12Migration(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS quality_inspections (
      id TEXT PRIMARY KEY,
      billet_id TEXT,
      rebar_size TEXT,
      yield_strength REAL,
      tensile_strength REAL,
      elongation_percent REAL,
      bend_test_passed INTEGER,
      visual_inspection TEXT,
      inspector_id TEXT,
      timestamp TEXT NOT NULL,
      sync_status TEXT DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

async function runVersion13Migration(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS quality_inspections (
      id TEXT PRIMARY KEY,
      billet_id TEXT,
      rebar_size TEXT,
      yield_strength REAL,
      tensile_strength REAL,
      elongation_percent REAL,
      bend_test_passed INTEGER,
      visual_inspection TEXT,
      inspector_id TEXT,
      timestamp TEXT NOT NULL,
      sync_status TEXT DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await safeAddColumn(db, 'quality_inspections', 'measured_diameter', 'REAL');
  await safeAddColumn(db, 'quality_inspections', 'cross_section_area', 'REAL');
  await safeAddColumn(db, 'quality_inspections', 'max_load_kgf', 'REAL');
}

async function runVersion14Migration(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS billets (
      id TEXT PRIMARY KEY,
      heat_number TEXT NOT NULL,
      batch_number TEXT,
      supplier_name TEXT,
      dimensions TEXT,
      length_meters REAL,
      initial_weight_kg REAL,
      grade TEXT,
      status TEXT DEFAULT 'IN_YARD',
      received_at TEXT,
      workshop_id TEXT,
      line_id TEXT,
      operator_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      sync_status TEXT DEFAULT 'pending',
      remote_id TEXT,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS furnace_logs (
      id TEXT PRIMARY KEY,
      billet_id TEXT,
      heat_number TEXT NOT NULL,
      charge_time TEXT NOT NULL,
      discharge_time TEXT,
      residence_time_minutes REAL,
      furnace_temperature_celsius REAL,
      operator_id TEXT,
      shift_id TEXT,
      machine_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      sync_status TEXT DEFAULT 'pending',
      remote_id TEXT,
      deleted_at TEXT,
      FOREIGN KEY (billet_id) REFERENCES billets (id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS rebar_bundles (
      id TEXT PRIMARY KEY,
      bundle_code TEXT UNIQUE NOT NULL,
      heat_number TEXT NOT NULL,
      billet_id TEXT,
      rebar_size INTEGER NOT NULL,
      rebar_grade TEXT NOT NULL,
      branch_count INTEGER,
      net_weight_kg REAL NOT NULL,
      production_log_id TEXT,
      quality_status TEXT DEFAULT 'PENDING',
      produced_at TEXT NOT NULL,
      operator_id TEXT,
      shift_id TEXT,
      line_id TEXT,
      workshop_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      sync_status TEXT DEFAULT 'pending',
      remote_id TEXT,
      deleted_at TEXT,
      FOREIGN KEY (billet_id) REFERENCES billets (id) ON DELETE SET NULL
    );
  `);
}

// ✅ ADDITIVE — V15: دارایی‌های فولادی + جدول تعمیرات پیشگیرانه (PM)
async function runVersion15Migration(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS pm_tasks (
        id TEXT PRIMARY KEY,
        machine_id TEXT NOT NULL,
        asset_name TEXT NOT NULL,
        task_title TEXT NOT NULL,
        interval_type TEXT NOT NULL,
        interval_value REAL NOT NULL,
        last_done_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        sync_status TEXT DEFAULT 'pending',
        remote_id TEXT
    );`);
  await db.execAsync(`
    INSERT OR IGNORE INTO machines (id, name, code) VALUES
        ('mach-furnace-01', 'کوره پیش‌گرم', 'F-01'),
        ('mach-stand-02', 'قفسه نورد شماره ۱', 'RS-01'),
        ('mach-stand-03', 'قفسه نورد شماره ۲', 'RS-02'),
        ('mach-cooling-04', 'بستر خنک‌کن (Cooling Bed)', 'CB-01'),
        ('mach-shear-05', 'قیچی برش (Shear)', 'SH-01');`);
  await db.execAsync(`
    INSERT OR IGNORE INTO pm_tasks (id, machine_id, asset_name, task_title, interval_type, interval_value) VALUES
        ('pm-roll-01', 'mach-stand-02', 'قفسه نورد شماره ۱', 'تعویض غلتک‌ها', 'tons', 500),
        ('pm-bearing-01', 'mach-stand-03', 'قفسه نورد شماره ۲', 'بازرسی و گریس‌کاری بلبرینگ‌ها', 'hours', 250),
        ('pm-cool-01', 'mach-cooling-04', 'بستر خنک‌کن', 'گریس‌کاری زنجیر و بررسی پین‌ها', 'days', 7),
        ('pm-shear-01', 'mach-shear-05', 'قیچی برش', 'بازرسی و تعویض تیغه‌ها', 'days', 1),
        ('pm-furnace-01', 'mach-furnace-01', 'کوره پیش‌گرم', 'بازرسی مشعل‌ها و نسوز', 'hours', 500);`);
}

// ✅ FIX: کلید خارجی در طول migration خاموش می‌شود (حل خطاهای FK در V2 و V8)
export async function initDB(): Promise<SQLite.SQLiteDatabase> {
  const db = await getDatabase();
  try {
    await db.execAsync('PRAGMA foreign_keys = OFF;');
    const userVersionResult = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
    let currentVersion = userVersionResult?.user_version ?? 0;

    if (currentVersion < 1) {
      await runVersion1Migration(db);
      currentVersion = 1;
      await db.execAsync('PRAGMA user_version = 1;');
    }
    if (currentVersion < 2) {
      await runVersion2Migration(db);
      currentVersion = 2;
      await db.execAsync('PRAGMA user_version = 2;');
    }
    if (currentVersion < 3) {
      await runVersion3Migration(db);
      currentVersion = 3;
      await db.execAsync('PRAGMA user_version = 3;');
    }
    if (currentVersion < 4) {
      await runVersion4Migration(db);
      currentVersion = 4;
      await db.execAsync('PRAGMA user_version = 4;');
    }
    if (currentVersion < 5) {
      await runVersion5Migration(db);
      currentVersion = 5;
      await db.execAsync('PRAGMA user_version = 5;');
    }
    if (currentVersion < 6) {
      await runVersion6Migration(db);
      currentVersion = 6;
      await db.execAsync('PRAGMA user_version = 6;');
    }
    if (currentVersion < 7) {
      await runVersion7Migration(db);
      currentVersion = 7;
      await db.execAsync('PRAGMA user_version = 7;');
    }
    if (currentVersion < 8) {
      await runVersion8Migration(db);
      currentVersion = 8;
      await db.execAsync('PRAGMA user_version = 8;');
    }

    if (currentVersion < 10) {
      await runVersion10Migration(db);
      currentVersion = 10;
      await db.execAsync('PRAGMA user_version = 10;');
    }
    if (currentVersion < 11) {
      await runVersion11Migration(db);
      currentVersion = 11;
      await db.execAsync('PRAGMA user_version = 11;');
    }
    if (currentVersion < 12) {
      await runVersion12Migration(db);
      currentVersion = 12;
      await db.execAsync('PRAGMA user_version = 12;');
    }
    if (currentVersion < 13) {
      await runVersion13Migration(db);
      currentVersion = 13;
      await db.execAsync('PRAGMA user_version = 13;');
    }
    if (currentVersion < 14) {
      console.log(`[SQLite Migration] Upgrading to Version 14 (Steel Traceability Module)...`);
      await runVersion14Migration(db);
      currentVersion = 14;
      await db.execAsync('PRAGMA user_version = 14;');
    }

    if (currentVersion < 15) {
      console.log(`[SQLite Migration] Upgrading to Version 15 (Steel Assets + Preventive Maintenance)...`);
      await runVersion15Migration(db);
      currentVersion = 15;
      await db.execAsync('PRAGMA user_version = 15;');
    }

    await repairLegacySchemas(db);
    await backfillAuditFields(db);
    await repairOperatorsSeed(db);
    await db.execAsync('PRAGMA foreign_keys = ON;');

    console.log(`[SQLite Migration] DB Init Complete. Final user_version: ${currentVersion}`);
    return db;
  } catch (error) {
    console.error('[SQLite Migration] Critical Error during initDB:', error);
    throw error;
  }
}