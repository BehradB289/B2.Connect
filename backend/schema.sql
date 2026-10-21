-- B2.Connect Cloudflare D1 (SQLite) Production Schema
-- Supports 50+ isolated virtual classrooms, granular attendance & focus telemetry,
-- live polls/quizzes, and R2 file vault metadata.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  instructor_name TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 30,
  active_layout TEXT NOT NULL DEFAULT 'whiteboard',
  active_template TEXT NOT NULL DEFAULT 'espresso',
  current_slide INTEGER NOT NULL DEFAULT 0,
  chat_locked INTEGER NOT NULL DEFAULT 0,
  exam_lock INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'live',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS participants (
  id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('teacher', 'assistant', 'student')),
  joined_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  active_minutes REAL NOT NULL DEFAULT 0,
  focus_state TEXT NOT NULL DEFAULT 'focused' CHECK(focus_state IN ('focused', 'away', 'idle')),
  tab_switches INTEGER NOT NULL DEFAULT 0,
  roll_call_verified INTEGER NOT NULL DEFAULT 1,
  mic_granted INTEGER NOT NULL DEFAULT 0,
  cam_granted INTEGER NOT NULL DEFAULT 0,
  pen_granted INTEGER NOT NULL DEFAULT 0,
  hand_raised INTEGER NOT NULL DEFAULT 0,
  hand_raised_at INTEGER,
  engagement_xp INTEGER NOT NULL DEFAULT 100,
  PRIMARY KEY (id, room_id),
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS attendance_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  participant_name TEXT NOT NULL,
  role TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('join', 'leave', 'reconnect', 'tab_blur', 'tab_focus', 'roll_call_pass', 'roll_call_miss')),
  timestamp INTEGER NOT NULL,
  metadata_json TEXT,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS polls (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  question TEXT NOT NULL,
  options_json TEXT NOT NULL,
  correct_option_index INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  duration_seconds INTEGER NOT NULL DEFAULT 60,
  created_at INTEGER NOT NULL,
  votes_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS shared_files (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  downloads INTEGER NOT NULL DEFAULT 0,
  uploaded_at INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_participants_room ON participants(room_id);
CREATE INDEX IF NOT EXISTS idx_attendance_room_time ON attendance_logs(room_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_polls_room ON polls(room_id);
CREATE INDEX IF NOT EXISTS idx_files_room ON shared_files(room_id);
