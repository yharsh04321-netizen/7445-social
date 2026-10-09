const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const app = express();
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_ORIGIN ? process.env.FRONTEND_ORIGIN.split(",").map(x => x.trim()) : true }));
app.use(express.json({ limit: "1mb" }));
app.use("/api/auth", rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("localhost") ? { rejectUnauthorized: false } : false
});
const JWT_SECRET = process.env.JWT_SECRET;
const PORT = process.env.PORT || 10000;
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const clean = s => String(s || "").trim();
const publicProfile = u => ({ id: u.id, display_name: u.display_name, username: u.username, created_at: u.created_at });
function auth(req, res, next) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  try { if (!token || !JWT_SECRET) throw new Error("unauthorized"); req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: "Please log in again." }); }
}
async function initDb() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is missing");
  if (!JWT_SECRET || JWT_SECRET.length < 32) throw new Error("Set JWT_SECRET to a random secret with at least 32 characters");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      display_name VARCHAR(50) NOT NULL,
      username VARCHAR(30) NOT NULL UNIQUE,
      email VARCHAR(254) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS posts (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content VARCHAR(2000) NOT NULL DEFAULT '',
      image_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (length(trim(content)) > 0 OR image_url IS NOT NULL)
    );
    CREATE TABLE IF NOT EXISTS likes (
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, post_id)
    );
    CREATE TABLE IF NOT EXISTS comments (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      content VARCHAR(500) NOT NULL CHECK (length(trim(content)) > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS follows (
      follower_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      following_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (follower_id, following_id),
      CHECK (follower_id <> following_id)
    );
    CREATE INDEX IF NOT EXISTS posts_created_at_idx ON posts(created_at DESC);
    CREATE INDEX IF NOT EXISTS comments_post_created_idx ON comments(post_id, created_at);
    CREATE INDEX IF NOT EXISTS follows_following_idx ON follows(following_id);
  `);
}
app.get("/api/health", asyncRoute(async (_req, res) => {
  await pool.query("SELECT 1");
  res.json({ ok: true, service: "7445-social-api" });
}));
app.post("/api/auth/signup", asyncRoute(async (req, res) => {
  const display_name = clean(req.body.display_name);
  const email = clean(req.body.email).toLowerCase();
  const password = String(req.body.password || "");
  let username = clean(req.body.username).toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24);
  if (display_name.length < 1 || display_name.length > 50) return res.status(400).json({ error: "Name must be 1–50 characters." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: "Enter a valid email address." });
  if (password.length < 8 || password.length > 128) return res.status(400).json({ error: "Password must be 8–128 characters." });
  if (username.length < 3) username = "member" + Math.random().toString(36).slice(2, 9);
  const password_hash = await bcrypt.hash(password, 12);
  try {
    const { rows } = await pool.query("INSERT INTO users(display_name,username,email,password_hash) VALUES($1,$2,$3,$4) RETURNING id,display_name,username,email,created_at", [display_name, username, email, password_hash]);
    const user = rows[0];
    const token = jwt.sign({ id: String(user.id), email: user.email }, JWT_SECRET, { expiresIn: "7d" });
    res.status(201).json({ token, user: publicProfile(user) });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "That email or username is already registered. Try logging in or choose another username." });
    throw e;
  }
}));
app.post("/api/auth/login", asyncRoute(async (req, res) => {
  const email = clean(req.body.email).toLowerCase(), password = String(req.body.password || "");
  const { rows } = await pool.query("SELECT id,display_name,username,email,password_hash,created_at FROM users WHERE email=$1", [email]);
  if (!rows[0] || !(await bcrypt.compare(password, rows[0].password_hash))) return res.status(401).json({ error: "Email or password is incorrect." });
  const u = rows[0], token = jwt.sign({ id: String(u.id), email: u.email }, JWT_SECRET, { expiresIn: "7d" });
  res.json({ token, user: publicProfile(u) });
}));
app.get("/api/me", auth, asyncRoute(async (req, res) => {
  const { rows } = await pool.query("SELECT id,display_name,username,email,created_at FROM users WHERE id=$1", [req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: "Account not found." });
  res.json({ user: publicProfile(rows[0]) });
}));
app.patch("/api/me", auth, asyncRoute(async (req, res) => {
  const name = clean(req.body.display_name);
  if (name.length < 1 || name.length > 50) return res.status(400).json({ error: "Name must be 1–50 characters." });
  const { rows } = await pool.query("UPDATE users SET display_name=$1 WHERE id=$2 RETURNING id,display_name,username,created_at", [name, req.user.id]);
  res.json({ user: publicProfile(rows[0]) });
}));
app.get("/api/profiles", asyncRoute(async (req, res) => {
  const q = clean(req.query.q);
  if (q.length < 2) return res.json({ profiles: [] });
  const { rows } = await pool.query("SELECT u.id,u.display_name,u.username,u.created_at,(SELECT count(*) FROM follows f WHERE f.following_id=u.id) AS followers_count FROM users u WHERE u.display_name ILIKE $1 OR u.username ILIKE $1 ORDER BY u.display_name LIMIT 25", ["%" + q.replace(/[%_\\]/g, "") + "%"]);
  res.json({ profiles: rows.map(publicProfile) });
}));
app.get("/api/posts", asyncRoute(async (req, res) => {
  const viewerId = req.headers.authorization && JWT_SECRET ? (() => { try { return jwt.verify(req.headers.authorization.replace(/^Bearer\s+/i, ""), JWT_SECRET).id; } catch { return null; } })() : null;
  const { rows } = await pool.query(`
    SELECT p.id,p.user_id,p.content,p.image_url,p.created_at,u.display_name,u.username,
      (SELECT count(*) FROM likes l WHERE l.post_id=p.id)::int AS likes_count,
      CASE WHEN $1::bigint IS NULL THEN false ELSE EXISTS(SELECT 1 FROM likes l WHERE l.post_id=p.id AND l.user_id=$1) END AS liked,
      (SELECT count(*) FROM comments c WHERE c.post_id=p.id)::int AS comments_count
    FROM posts p JOIN users u ON u.id=p.user_id ORDER BY p.created_at DESC LIMIT 50
  `, [viewerId]);
  const postIds = rows.map(p => p.id);
  let comments = [];
  if (postIds.length) {
    const result = await pool.query(`SELECT c.id,c.post_id,c.content,c.created_at,u.display_name,u.username FROM comments c JOIN users u ON u.id=c.user_id WHERE c.post_id=ANY($1::bigint[]) ORDER BY c.created_at`, [postIds]);
    comments = result.rows;
  }
  res.json({ posts: rows.map(p => ({ ...p, profiles: { display_name: p.display_name, username: p.username }, comments: comments.filter(c => String(c.post_id) === String(p.id)).map(c => ({ id: c.id, content: c.content, created_at: c.created_at, profiles: { display_name: c.display_name, username: c.username } })) })) });
}));
app.post("/api/posts", auth, asyncRoute(async (req, res) => {
  const content = clean(req.body.content), image_url = req.body.image_url ? clean(req.body.image_url) : null;
  if (content.length > 2000 || (!content && !image_url)) return res.status(400).json({ error: "Write a post (up to 2,000 characters) or add an image URL." });
  if (image_url && !/^https:\/\//i.test(image_url)) return res.status(400).json({ error: "Image links must use HTTPS." });
  const { rows } = await pool.query("INSERT INTO posts(user_id,content,image_url) VALUES($1,$2,$3) RETURNING id,user_id,content,image_url,created_at", [req.user.id, content, image_url]);
  res.status(201).json({ post: rows[0] });
}));
app.patch("/api/posts/:id", auth, asyncRoute(async (req, res) => {
  const content = clean(req.body.content), image_url = req.body.image_url ? clean(req.body.image_url) : null;
  if (content.length > 2000 || (!content && !image_url)) return res.status(400).json({ error: "A post must contain text (up to 2,000 characters) or an image URL." });
  if (image_url && !/^https:\/\//i.test(image_url)) return res.status(400).json({ error: "Image links must use HTTPS." });
  const { rows } = await pool.query("UPDATE posts SET content=$1,image_url=$2 WHERE id=$3 AND user_id=$4 RETURNING id,user_id,content,image_url,created_at", [content, image_url, req.params.id, req.user.id]);
  if (!rows.length) return res.status(404).json({ error: "Post not found or not yours." });
  res.json({ post: rows[0] });
}));
app.delete("/api/posts/:id", auth, asyncRoute(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const owned = await client.query("SELECT id FROM posts WHERE id=$1 AND user_id=$2 FOR UPDATE", [req.params.id, req.user.id]);
    if (!owned.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Post not found or not yours." }); }
    await client.query("DELETE FROM comments WHERE post_id=$1", [req.params.id]);
    await client.query("DELETE FROM likes WHERE post_id=$1", [req.params.id]);
    await client.query("DELETE FROM posts WHERE id=$1 AND user_id=$2", [req.params.id, req.user.id]);
    await client.query("COMMIT");
    res.status(204).end();
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally { client.release(); }
}));
app.post("/api/posts/:id/likes", auth, asyncRoute(async (req, res) => {
  const { rows } = await pool.query("INSERT INTO likes(user_id,post_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING post_id", [req.user.id, req.params.id]);
  if (!rows.length) await pool.query("DELETE FROM likes WHERE user_id=$1 AND post_id=$2", [req.user.id, req.params.id]);
  const result = await pool.query("SELECT count(*)::int AS count, EXISTS(SELECT 1 FROM likes WHERE user_id=$1 AND post_id=$2) AS liked FROM likes WHERE post_id=$2", [req.user.id, req.params.id]);
  res.json({ likes_count: result.rows[0].count, liked: result.rows[0].liked });
}));
app.post("/api/posts/:id/comments", auth, asyncRoute(async (req, res) => {
  const content = clean(req.body.content);
  if (!content || content.length > 500) return res.status(400).json({ error: "Comment must be 1–500 characters." });
  const { rows } = await pool.query("INSERT INTO comments(user_id,post_id,content) VALUES($1,$2,$3) RETURNING id,post_id,content,created_at", [req.user.id, req.params.id, content]);
  res.status(201).json({ comment: rows[0] });
}));
app.post("/api/profiles/:id/follow", auth, asyncRoute(async (req, res) => {
  if (String(req.user.id) === String(req.params.id)) return res.status(400).json({ error: "You cannot follow yourself." });
  const existing = await pool.query("SELECT 1 FROM follows WHERE follower_id=$1 AND following_id=$2", [req.user.id, req.params.id]);
  if (existing.rowCount) await pool.query("DELETE FROM follows WHERE follower_id=$1 AND following_id=$2", [req.user.id, req.params.id]);
  else await pool.query("INSERT INTO follows(follower_id,following_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [req.user.id, req.params.id]);
  const result = await pool.query("SELECT EXISTS(SELECT 1 FROM follows WHERE follower_id=$1 AND following_id=$2) AS following", [req.user.id, req.params.id]);
  res.json(result.rows[0]);
}));
app.use((err, _req, res, _next) => {
  console.error(err);
  if (res.headersSent) return;
  res.status(500).json({ error: "Something went wrong on the server. Please try again." });
});
initDb().then(() => app.listen(PORT, "0.0.0.0", () => console.log("7445 Social API listening on", PORT))).catch(err => { console.error("Startup failed:", err.message); process.exit(1); });
