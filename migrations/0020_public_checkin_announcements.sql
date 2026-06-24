CREATE TABLE IF NOT EXISTS public_checkin_announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL,
  source_key TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'warning', 'error')),
  source_url TEXT,
  first_seen_at INTEGER NOT NULL DEFAULT (unixepoch()),
  last_seen_at INTEGER NOT NULL DEFAULT (unixepoch()),
  read_at INTEGER,
  FOREIGN KEY (site_id) REFERENCES public_checkin_sites(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS public_checkin_announcements_site_source_unique
ON public_checkin_announcements (site_id, source_key);

CREATE INDEX IF NOT EXISTS public_checkin_announcements_site_first_seen_idx
ON public_checkin_announcements (site_id, first_seen_at DESC);

CREATE INDEX IF NOT EXISTS public_checkin_announcements_read_at_idx
ON public_checkin_announcements (read_at);
