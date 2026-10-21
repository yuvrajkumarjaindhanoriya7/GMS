require("dotenv").config();

const path = require("path");
const fs = require("fs");
const express = require("express");
const helmet = require("helmet");
const session = require("express-session");
const SQLiteStoreFactory = require("connect-sqlite3");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === "production";
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.error("Set SESSION_SECRET in .env to a random string at least 32 characters long.");
  process.exit(1);
}

if (isProduction) app.set("trust proxy", 1);

const dataDir = path.resolve(process.env.DATABASE_PATH
  ? path.dirname(process.env.DATABASE_PATH)
  : path.join(__dirname, "data"));
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.resolve(process.env.DATABASE_PATH || path.join(dataDir, "gms.sqlite"));
const sessionDir = path.join(__dirname, "data");
fs.mkdirSync(sessionDir, { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
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
    is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0,1)),
    deleted_by_sender INTEGER NOT NULL DEFAULT 0 CHECK (deleted_by_sender IN (0,1)),
    deleted_by_receiver INTEGER NOT NULL DEFAULT 0 CHECK (deleted_by_receiver IN (0,1))
  );

  CREATE INDEX IF NOT EXISTS idx_mails_receiver ON mails(receiver_id, deleted_by_receiver, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_mails_sender ON mails(sender_id, deleted_by_sender, created_at DESC);
`);

const SQLiteStore = SQLiteStoreFactory(session);
app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  }
}));
app.use(express.json({ limit: "32kb" }));
app.use(session({
  name: "gms.sid",
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: new SQLiteStore({
    db: "sessions.sqlite",
    dir: sessionDir,
    table: "sessions",
    concurrentDB: true
  }),
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many login or registration attempts. Try again in 15 minutes." }
});
const sendLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "You're sending messages too quickly. Please wait a moment." }
});

function cleanUsername(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}
function validUsername(username) {
  return /^[a-zA-Z0-9_]{3,24}$/.test(username);
}
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Please log in first." });
  next();
}
function currentUser(req) {
  return { id: req.session.user.id, username: req.session.user.username };
}
function safeMail(row) {
  return {
    id: row.id,
    sender: row.sender,
    receiver: row.receiver,
    subject: row.subject,
    body: row.body,
    createdAt: row.created_at,
    isRead: Boolean(row.is_read)
  };
}
const inboxQuery = db.prepare(`
  SELECT m.id, s.username AS sender, r.username AS receiver, m.subject, m.body, m.created_at, m.is_read
  FROM mails m
  JOIN users s ON s.id = m.sender_id
  JOIN users r ON r.id = m.receiver_id
  WHERE m.receiver_id = ? AND m.deleted_by_receiver = 0
  ORDER BY m.created_at DESC, m.id DESC
`);
const sentQuery = db.prepare(`
  SELECT m.id, s.username AS sender, r.username AS receiver, m.subject, m.body, m.created_at, m.is_read
  FROM mails m
  JOIN users s ON s.id = m.sender_id
  JOIN users r ON r.id = m.receiver_id
  WHERE m.sender_id = ? AND m.deleted_by_sender = 0
  ORDER BY m.created_at DESC, m.id DESC
`);

app.post("/api/register", authLimiter, async (req, res, next) => {
  try {
    const username = cleanUsername(req.body?.username);
    const password = req.body?.password;
    if (!validUsername(username)) {
      return res.status(400).json({ error: "Username must be 3–24 characters using letters, numbers, or underscores." });
    }
    if (typeof password !== "string" || password.length < 10 || password.length > 72) {
      return res.status(400).json({ error: "Password must be 10–72 characters long." });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    let result;
    try {
      result = db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(username, passwordHash);
    } catch (error) {
      if (String(error.code).startsWith("SQLITE_CONSTRAINT")) {
        return res.status(409).json({ error: "That username is already taken." });
      }
      throw error;
    }
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { id: Number(result.lastInsertRowid), username };
      req.session.save((saveErr) => {
        if (saveErr) return next(saveErr);
        res.status(201).json({ user: currentUser(req) });
      });
    });
  } catch (error) { next(error); }
});

app.post("/api/login", authLimiter, async (req, res, next) => {
  try {
    const username = cleanUsername(req.body?.username);
    const password = req.body?.password;
    if (!username || typeof password !== "string") {
      return res.status(400).json({ error: "Enter your username and password." });
    }
    const user = db.prepare("SELECT id, username, password_hash FROM users WHERE username = ? COLLATE NOCASE").get(username);
    const matches = user ? await bcrypt.compare(password, user.password_hash) : false;
    if (!matches) return res.status(401).json({ error: "Incorrect username or password." });
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { id: user.id, username: user.username };
      req.session.save((saveErr) => {
        if (saveErr) return next(saveErr);
        res.json({ user: currentUser(req) });
      });
    });
  } catch (error) { next(error); }
});

app.post("/api/logout", requireAuth, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie("gms.sid", { httpOnly: true, sameSite: "lax", secure: isProduction });
    res.json({ ok: true });
  });
});

app.get("/api/me", (req, res) => {
  res.json({ user: req.session.user ? currentUser(req) : null });
});

app.get("/api/mail/:folder", requireAuth, (req, res) => {
  const folder = req.params.folder;
  if (folder !== "inbox" && folder !== "sent") return res.status(404).json({ error: "Unknown folder." });
  const user = currentUser(req);
  const rows = (folder === "inbox" ? inboxQuery : sentQuery).all(user.id);
  res.json({ mails: rows.map(safeMail) });
});

app.post("/api/mail", requireAuth, sendLimiter, (req, res) => {
  const receiverUsername = cleanUsername(req.body?.receiver);
  const subject = typeof req.body?.subject === "string" ? req.body.subject.trim() : "";
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  if (!validUsername(receiverUsername)) return res.status(400).json({ error: "Enter a valid receiver username." });
  if (subject.length > 120) return res.status(400).json({ error: "Subject must be 120 characters or fewer." });
  if (!body || body.length > 10000) return res.status(400).json({ error: "Message must contain 1–10,000 characters." });

  const sender = currentUser(req);
  const receiver = db.prepare("SELECT id, username FROM users WHERE username = ? COLLATE NOCASE").get(receiverUsername);
  if (!receiver) return res.status(404).json({ error: "That receiver username doesn't exist." });
  if (receiver.id === sender.id) return res.status(400).json({ error: "You can't send mail to yourself in this version." });

  const result = db.prepare("INSERT INTO mails (sender_id, receiver_id, subject, body) VALUES (?, ?, ?, ?)")
    .run(sender.id, receiver.id, subject, body);
  const row = db.prepare(`
    SELECT m.id, s.username AS sender, r.username AS receiver, m.subject, m.body, m.created_at, m.is_read
    FROM mails m JOIN users s ON s.id=m.sender_id JOIN users r ON r.id=m.receiver_id
    WHERE m.id = ?
  `).get(result.lastInsertRowid);
  res.status(201).json({ mail: safeMail(row) });
});

app.post("/api/mail/:id/read", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid mail ID." });
  const result = db.prepare("UPDATE mails SET is_read = 1 WHERE id = ? AND receiver_id = ? AND deleted_by_receiver = 0")
    .run(id, currentUser(req).id);
  if (!result.changes) return res.status(404).json({ error: "Mail not found in your inbox." });
  res.json({ ok: true });
});

app.post("/api/mail/:id/unread", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid mail ID." });
  const result = db.prepare("UPDATE mails SET is_read = 0 WHERE id = ? AND receiver_id = ? AND deleted_by_receiver = 0")
    .run(id, currentUser(req).id);
  if (!result.changes) return res.status(404).json({ error: "Mail not found in your inbox." });
  res.json({ ok: true });
});

app.delete("/api/mail/:id", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Invalid mail ID." });
  const userId = currentUser(req).id;
  const senderResult = db.prepare("UPDATE mails SET deleted_by_sender = 1 WHERE id = ? AND sender_id = ? AND deleted_by_sender = 0").run(id, userId);
  const receiverResult = db.prepare("UPDATE mails SET deleted_by_receiver = 1 WHERE id = ? AND receiver_id = ? AND deleted_by_receiver = 0").run(id, userId);
  if (!senderResult.changes && !receiverResult.changes) return res.status(404).json({ error: "Mail not found in your folder." });
  db.prepare("DELETE FROM mails WHERE id = ? AND deleted_by_sender = 1 AND deleted_by_receiver = 1").run(id);
  res.json({ ok: true });
});

app.get("/api/search", requireAuth, (req, res) => {
  const query = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
  const folder = req.query.folder === "sent" ? "sent" : "inbox";
  const userId = currentUser(req).id;
  const sql = folder === "sent"
    ? `SELECT m.id, s.username AS sender, r.username AS receiver, m.subject, m.body, m.created_at, m.is_read
       FROM mails m JOIN users s ON s.id=m.sender_id JOIN users r ON r.id=m.receiver_id
       WHERE m.sender_id = ? AND m.deleted_by_sender = 0
       AND (m.subject LIKE ? ESCAPE '\\' OR m.body LIKE ? ESCAPE '\\' OR r.username LIKE ? ESCAPE '\\')
       ORDER BY m.created_at DESC, m.id DESC`
    : `SELECT m.id, s.username AS sender, r.username AS receiver, m.subject, m.body, m.created_at, m.is_read
       FROM mails m JOIN users s ON s.id=m.sender_id JOIN users r ON r.id=m.receiver_id
       WHERE m.receiver_id = ? AND m.deleted_by_receiver = 0
       AND (m.subject LIKE ? ESCAPE '\\' OR m.body LIKE ? ESCAPE '\\' OR s.username LIKE ? ESCAPE '\\')
       ORDER BY m.created_at DESC, m.id DESC`;
  const escaped = query.replace(/[\\%_]/g, "\\$&");
  const pattern = `%${escaped}%`;
  const rows = db.prepare(sql).all(userId, pattern, pattern, pattern);
  res.json({ mails: rows.map(safeMail) });
});

app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

app.listen(PORT, () => {
  console.log(`GMS is running at http://localhost:${PORT}`);
  console.log(`SQLite database: ${dbPath}`);
});
