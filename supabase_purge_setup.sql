-- 1. Create the system_metadata table
CREATE TABLE IF NOT EXISTS system_metadata (
  id INTEGER PRIMARY KEY DEFAULT 1,
  last_purge_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Insert the initial row if it doesn't exist
INSERT INTO system_metadata (id, last_purge_at)
VALUES (1, NOW())
ON CONFLICT (id) DO NOTHING;

-- 3. Function to trigger a purge (Run this when you want to reset everyone)
-- Usage: SELECT trigger_remote_purge();
CREATE OR REPLACE FUNCTION trigger_remote_purge()
RETURNS TIMESTAMP AS $$
DECLARE
  new_time TIMESTAMP;
BEGIN
  new_time := NOW();
  UPDATE system_metadata SET last_purge_at = new_time WHERE id = 1;
  
  -- Optional: Clear server data too if you want everything gone
  -- DELETE FROM production_logs;
  -- DELETE FROM downtime_logs;
  
  RETURN new_time;
END;
$$ LANGUAGE plpgsql;

-- 4. Enable RLS (Row Level Security) if needed, allowing read access to authenticated users
ALTER TABLE system_metadata ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for all users" ON system_metadata
  FOR SELECT USING (true);
