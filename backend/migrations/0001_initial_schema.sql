PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS students (
 id TEXT PRIMARY KEY, student_number TEXT NOT NULL UNIQUE,
 first_name TEXT NOT NULL, last_name TEXT NOT NULL, grade_section TEXT,
 email TEXT, status TEXT NOT NULL DEFAULT 'active',
 qr_token_hash TEXT UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS admins (
 id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
 name TEXT, role TEXT NOT NULL DEFAULT 'admin', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
 id TEXT PRIMARY KEY, admin_id TEXT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
 refresh_token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS attendance (
 id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES students(id),
 attendance_date TEXT NOT NULL, time_in TEXT, time_out TEXT,
 status TEXT NOT NULL DEFAULT 'present', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(student_id, attendance_date)
);
CREATE TABLE IF NOT EXISTS settings (
 key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS audit_logs (
 id TEXT PRIMARY KEY, admin_id TEXT, action TEXT NOT NULL, entity_type TEXT,
 entity_id TEXT, details TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO settings(key,value) VALUES
 ('school_start_time','07:30'),('grace_period','10'),('timezone','Asia/Manila');
