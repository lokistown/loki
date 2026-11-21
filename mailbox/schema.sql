CREATE TABLE IF NOT EXISTS offerings (
  id TEXT PRIMARY KEY,
  visitor_id TEXT NOT NULL,
  nick TEXT NOT NULL,
  text TEXT,
  has_image INTEGER DEFAULT 0,
  created INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reply TEXT,
  question TEXT,
  resolved INTEGER,
  ip_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_status ON offerings (status, created);
CREATE INDEX IF NOT EXISTS idx_visitor ON offerings (visitor_id, created);
CREATE INDEX IF NOT EXISTS idx_ip ON offerings (ip_hash, created);
CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  data BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  source TEXT,
  type TEXT,
  amount REAL,
  currency TEXT,
  product TEXT,
  from_name TEXT,
  message TEXT,
  is_public INTEGER,
  created INTEGER,
  verified INTEGER
);
