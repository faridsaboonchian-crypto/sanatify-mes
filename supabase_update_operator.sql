-- Add operator_name column to production_logs
ALTER TABLE production_logs ADD COLUMN IF NOT EXISTS operator_name TEXT;

-- Add operator_name column to downtime_logs
ALTER TABLE downtime_logs ADD COLUMN IF NOT EXISTS operator_name TEXT;

-- (Optional) Update existing records to 'unknown' if needed
-- UPDATE production_logs SET operator_name = 'نامشخص' WHERE operator_name IS NULL;
-- UPDATE downtime_logs SET operator_name = 'نامشخص' WHERE operator_name IS NULL;
