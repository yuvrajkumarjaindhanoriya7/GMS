# GMS — G-Mailing Services

A username-based mailing web app built with HTML, CSS, JavaScript, Node.js, Express, SQLite, and secure server-side sessions.

## Features

- Register and log in with a username and password
- Password hashing with bcrypt
- Server-side sessions stored in SQLite
- Send messages to other registered usernames
- Persistent inbox and sent folder
- Read/unread status
- Delete from your own folder without deleting the other person's copy
- Search by subject, body, and sender/receiver username
- Parameterized SQL queries, basic rate limits, Helmet security headers, and HTTP-only session cookie
- Responsive dark interface

## Requirements

- Node.js 20 or newer
- npm

## Run locally

1. Extract this folder.
2. Open a terminal in the project folder.
3. Install dependencies:

   ```bash
   npm install
   ```

4. Create a `.env` file by copying `.env.example`.
   - Windows Command Prompt: `copy .env.example .env`
   - PowerShell: `Copy-Item .env.example .env`
   - macOS/Linux: `cp .env.example .env`
5. Edit `.env` and set `SESSION_SECRET` to a random secret at least 32 characters long. Example generation with Node:

   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

6. Start the app:

   ```bash
   npm start
   ```

7. Open `http://localhost:3000`.

The SQLite database is created at `data/gms.sqlite`. Session records are stored in `data/sessions.sqlite`. Do not delete these files if you want to preserve local accounts and mail.

## Test the mail flow

1. Choose a username of your own and create an account with a password of at least 10 characters.
2. Log out, then create a second account using another username and a different password.
3. Log in to the first account and send mail to the second account’s exact username.
4. Log out and log in to the second account; the message should appear in its Inbox.
5. Check Inbox, Sent mail, search, read/unread, and delete. Restart the server and verify that accounts and messages remain in SQLite.

No demo accounts are pre-created. Use usernames you control and unique test passwords; do not reuse passwords from other services.

## Free online hosting

### Important database persistence warning

SQLite only persists as long as the host keeps the database file on a persistent disk. Many free application hosts use ephemeral filesystems and can delete local database files during redeploys, restarts, or sleep/wake cycles. Do **not** deploy this app to an ephemeral filesystem and assume that its SQLite file is permanent.

For production-style free hosting, choose a host that supports a persistent disk for SQLite, or change the database layer to a hosted PostgreSQL service. Free plan limits and availability change; verify current terms before deploying.

### General deployment checklist

1. Push this project to a Git repository. Never commit `.env`, database files, or `node_modules`.
2. Create a Node.js web service from the repository on a host that supports Node.
3. Build/install command: `npm install`.
4. Start command: `npm start`.
5. Set environment variables:
   - `NODE_ENV=production`
   - `SESSION_SECRET=<a long random secret>`
   - `PORT` is usually supplied by the host; the server uses it automatically.
   - `DATABASE_PATH` should point to a file on the host's persistent disk, if using SQLite.
6. Enable HTTPS. The app sets secure session cookies in production.
7. Confirm the database is on persistent storage and configure backups.
8. Test registration, login, sending, receiving, search, read/unread, and deletion after a redeploy.

### Using hosted PostgreSQL instead

This starter currently uses SQLite. If your chosen free host does not offer persistent disk, use a hosted PostgreSQL database and migrate the `users` and `mails` schema plus queries. Do not use browser localStorage as a replacement for a server database.

## API overview

- `POST /api/register` — `{ "username": "...", "password": "..." }`
- `POST /api/login` — same shape
- `POST /api/logout`
- `GET /api/me`
- `GET /api/mail/inbox`
- `GET /api/mail/sent`
- `POST /api/mail` — `{ "receiver": "...", "subject": "...", "body": "..." }`
- `POST /api/mail/:id/read`
- `POST /api/mail/:id/unread`
- `DELETE /api/mail/:id`
- `GET /api/search?q=term&folder=inbox|sent`

## Security and limitations

- Use HTTPS for any online deployment.
- The session secret must be private and strong.
- Passwords are hashed; plaintext passwords are never stored.
- API endpoints verify the signed-in user on the server. Inbox queries are scoped to the authenticated account.
- User content is rendered as text/escaped HTML, not executable markup.
- Rate limiting is included for authentication and sending.
- This is a starter project, not a full enterprise mail provider. It does not send emails to external addresses; messages are internal to GMS usernames.
- Add a persistent database plan, backups, monitoring, CSRF protection, email recovery, and account moderation before inviting the public.
