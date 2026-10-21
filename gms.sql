-- GMS (G-Mailing Services) SQLite database schema
-- Compatible with the current gms-mailing-system/server.js.
-- This creates the tables and indexes only; it does NOT create demo accounts.
-- Run this against a NEW/empty GMS database. Back up existing data first.

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mails (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL REFERENCES users(id),
    receiver_id INTEGER NOT NULL REFERENCES users(id),
    subject TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
    deleted_by_sender INTEGER NOT NULL DEFAULT 0 CHECK (deleted_by_sender IN (0, 1)),
    deleted_by_receiver INTEGER NOT NULL DEFAULT 0 CHECK (deleted_by_receiver IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_mails_receiver
    ON mails(receiver_id, deleted_by_receiver, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mails_sender
    ON mails(sender_id, deleted_by_sender, created_at DESC);
