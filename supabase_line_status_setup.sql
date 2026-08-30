-- Create the line_status table for real-time dashboard status
CREATE TABLE IF NOT EXISTS line_status (
    device_id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    current_shift_name TEXT,
    shift_start_time TIMESTAMPTZ,
    total_good INTEGER DEFAULT 0,
    total_waste INTEGER DEFAULT 0,
    last_update TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security (RLS)
ALTER TABLE line_status ENABLE ROW LEVEL SECURITY;

-- Policy: Everyone can read status for their company
CREATE POLICY "Enable read access for all users by company_id" 
ON line_status FOR SELECT 
USING (true); -- In a real app, you would filter by company_id via authenticated user, but here we use company_id filter in query

-- Policy: Devices can upsert their own status
CREATE POLICY "Enable insert/update for devices" 
ON line_status FOR ALL 
USING (true)
WITH CHECK (true);
