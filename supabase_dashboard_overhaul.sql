-- 1. Table for Status-Based Dashboard (UPSERT from Tablet)
CREATE TABLE IF NOT EXISTS line_status (
    device_id TEXT NOT NULL,
    company_id TEXT NOT NULL,
    current_shift_name TEXT,
    shift_start_time TIMESTAMPTZ,
    total_good INTEGER DEFAULT 0,
    total_waste INTEGER DEFAULT 0,
    last_update TIMESTAMPTZ DEFAULT NOW(),
    current_status TEXT DEFAULT 'Offline',
    PRIMARY KEY (device_id, company_id)
);

-- 2. Table for Remote Configuration (UPSERT from Manager, FETCH by Tablet)
CREATE TABLE IF NOT EXISTS line_configs (
    device_id TEXT NOT NULL,
    company_id TEXT NOT NULL,
    target INTEGER DEFAULT 1000,
    cycle_time INTEGER DEFAULT 10,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (device_id, company_id)
);

-- Enable RLS
ALTER TABLE line_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_configs ENABLE ROW LEVEL SECURITY;

-- 3. Idempotent Policies (Drop if exists then create)
DO $$
BEGIN
    -- line_status policies
    IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow read for all' AND tablename = 'line_status') THEN
        DROP POLICY "Allow read for all" ON line_status;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow tablet upsert status' AND tablename = 'line_status') THEN
        DROP POLICY "Allow tablet upsert status" ON line_status;
    END IF;

    -- line_configs policies
    IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow read for all' AND tablename = 'line_configs') THEN
        DROP POLICY "Allow read for all" ON line_configs;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow manager upsert config' AND tablename = 'line_configs') THEN
        DROP POLICY "Allow manager upsert config" ON line_configs;
    END IF;
END $$;

-- Create Policies
CREATE POLICY "Allow read for all" ON line_status FOR SELECT USING (true);
CREATE POLICY "Allow tablet upsert status" ON line_status FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow read for all" ON line_configs FOR SELECT USING (true);
CREATE POLICY "Allow manager upsert config" ON line_configs FOR ALL USING (true) WITH CHECK (true);
