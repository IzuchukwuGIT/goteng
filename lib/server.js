import {
  createCipheriv,
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import mysql from "mysql2/promise";

const scrypt = promisify(scryptCallback);
const sessionLifetimeSeconds = 12 * 60 * 60;
const allowedCategories = new Set([
  "Clothing and Fashion",
  "Automobiles",
  "Auto Spare Parts",
  "Mobile devices and Gadgets",
  "Mobile phone accessories",
  "Electronics",
  "Kitchen Appliances",
  "Home decor",
  "Real Estate",
  "Cakes and pastries",
  "Skincare essentials",
  "Toiletries",
  "Personal care",
  "Educational Materials",
  "Other",
]);
let connectionPool;

export function database() {
  if (!connectionPool) {
    const connectionLimit = 5;
    if (process.env.MYSQL_URL) {
      const url = new URL(process.env.MYSQL_URL);
      const databaseName = decodeURIComponent(url.pathname.slice(1));
      if (url.protocol !== "mysql:" || !databaseName) {
        throw new Error("MYSQL_URL must be a valid mysql:// connection URL.");
      }
      connectionPool = mysql.createPool({
        host: url.hostname,
        port: Number(url.port || 3306),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        database: databaseName,
        ssl: process.env.MYSQL_SSL === "false" ? undefined : { rejectUnauthorized: true },
        connectionLimit,
        waitForConnections: true,
        queueLimit: 0,
        charset: "utf8mb4",
        timezone: "Z",
      });
    } else {
      const required = ["MYSQL_HOST", "MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_DATABASE"];
      const missing = required.filter((name) => !process.env[name]);
      if (missing.length) throw new Error(`Missing database configuration: ${missing.join(", ")}.`);
      connectionPool = mysql.createPool({
        host: process.env.MYSQL_HOST,
        port: Number(process.env.MYSQL_PORT || 3306),
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database: process.env.MYSQL_DATABASE,
        ssl: process.env.MYSQL_SSL === "true" ? { rejectUnauthorized: true } : undefined,
        connectionLimit,
        waitForConnections: true,
        queueLimit: 0,
        charset: "utf8mb4",
        timezone: "Z",
      });
    }
  }
  return connectionPool;
}

export function sendJson(res, status, payload, headers = {}) {
  res.status(status).setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  res.json(payload);
}

export function methodNotAllowed(res, methods) {
  sendJson(res, 405, { error: "Method not allowed." }, { Allow: methods.join(", ") });
}

export function sameOrigin(req, res) {
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host === req.headers.host) return true;
    } catch {
      // Reject malformed origins below.
    }
    sendJson(res, 403, { error: "Cross-origin requests are not allowed." });
    return false;
  }
  return true;
}

export function sessionCookie(token, maxAge = sessionLifetimeSeconds) {
  const parts = [
    `gote_session=${token}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${maxAge}`,
  ];
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  return parts.join("; ");
}

function readSessionToken(req) {
  const cookie = req.headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("gote_session="));
  return cookie?.slice("gote_session=".length) || null;
}

export async function currentSeller(req) {
  const token = readSessionToken(req);
  if (!token) return null;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const [rows] = await database().execute(
    `SELECT sellers.id, sellers.store_name, sellers.email, sellers.phone,
            sellers.product_category
     FROM seller_sessions
     JOIN sellers ON sellers.id = seller_sessions.seller_id
     WHERE seller_sessions.token_hash = ? AND seller_sessions.expires_at > ?`,
    [tokenHash, new Date().toISOString()],
  );
  return rows[0] || null;
}

export async function requireSeller(req, res) {
  const seller = await currentSeller(req);
  if (!seller) {
    sendJson(res, 401, { error: "Sign in to your seller account first." });
    return null;
  }
  return seller;
}

export function sellerProfile(row) {
  return {
    id: row.id,
    storeName: row.store_name,
    email: row.email,
    phone: row.phone,
    productCategory: row.product_category,
  };
}

export function validateApplication(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Invalid application." };
  }
  const limits = {
    storeName: 80,
    address: 180,
    phone: 20,
    email: 254,
    productCategory: 80,
    otherCategory: 80,
    products: 500,
    nin: 11,
    password: 128,
    passwordConfirm: 128,
  };
  const fields = {};
  for (const [name, limit] of Object.entries(limits)) {
    if (typeof body[name] !== "string") return { error: "Check the application fields and try again." };
    fields[name] = ["password", "passwordConfirm"].includes(name)
      ? body[name]
      : body[name].trim();
    if (fields[name].length > limit) return { error: "One or more application fields are too long." };
  }
  for (const name of ["storeName", "address", "phone", "email", "products", "nin"]) {
    if (!fields[name]) return { error: "Please complete all required fields." };
  }
  if (!/^[0-9]{11}$/.test(fields.nin)) return { error: "Enter a valid 11-digit NIN." };
  if (!/^\+?[0-9]{7,15}$/.test(fields.phone)) return { error: "Enter a valid phone number." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fields.email)) return { error: "Enter a valid email address." };
  fields.email = fields.email.toLowerCase();
  if (!allowedCategories.has(fields.productCategory)) return { error: "Choose a valid product category." };
  if (fields.password.length < 12) return { error: "Choose a password with at least 12 characters." };
  if (fields.password !== fields.passwordConfirm) return { error: "Your passwords do not match." };
  if (fields.productCategory === "Other" && !fields.otherCategory) {
    return { error: "Please specify your product category." };
  }
  if (fields.productCategory !== "Other") fields.otherCategory = "";
  return { fields };
}

export function encryptNin(nin) {
  const encodedKey = process.env.GOTE_NIN_ENCRYPTION_KEY;
  if (!encodedKey) throw new Error("GOTE_NIN_ENCRYPTION_KEY is not configured.");
  const key = Buffer.from(encodedKey, "base64url");
  if (key.length !== 32) throw new Error("GOTE_NIN_ENCRYPTION_KEY must decode to 32 bytes.");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(nin, "ascii"), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
}

export async function hashPassword(password, salt = randomBytes(16)) {
  const hash = await scrypt(password, salt, 32);
  return { salt, hash: Buffer.from(hash) };
}

export async function passwordsMatch(password, salt, expectedHash) {
  const actual = await scrypt(password, salt, expectedHash.length);
  return timingSafeEqual(Buffer.from(actual), expectedHash);
}

export function createSessionToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: createHash("sha256").update(token).digest("hex") };
}

export function sessionExpiry() {
  return new Date(Date.now() + sessionLifetimeSeconds * 1000).toISOString();
}

export async function getSellerProducts(sellerId) {
  const [rows] = await database().execute(
    `SELECT products.id, products.seller_id, products.name, products.description,
            products.price, sellers.store_name, sellers.phone, sellers.product_category
     FROM products
     JOIN sellers ON sellers.id = products.seller_id
     WHERE products.seller_id = ?
     ORDER BY products.created_at DESC, products.id DESC`,
    [sellerId],
  );
  return withProductImages(rows);
}

export async function getPublicProducts() {
  const [rows] = await database().execute(
    `SELECT products.id, products.seller_id, products.name, products.description,
            products.price, sellers.store_name, sellers.phone, sellers.product_category
     FROM products
     JOIN sellers ON sellers.id = products.seller_id
     ORDER BY products.created_at DESC, products.id DESC`,
  );
  return withProductImages(rows);
}

export function parseCookie(req, cookieName) {
  const cookie = req.headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`));
  return cookie?.slice(cookieName.length + 1) || null;
}

async function withProductImages(rows) {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => "?").join(", ");
  const [images] = await database().execute(
    `SELECT product_id, blob_url FROM product_images
     WHERE product_id IN (${placeholders}) ORDER BY product_id, position`,
    ids,
  );
  const imagesByProduct = new Map();
  for (const image of images) {
    const list = imagesByProduct.get(image.product_id) || [];
    list.push(image.blob_url);
    imagesByProduct.set(image.product_id, list);
  }
  return rows.map((row) => ({
    id: row.id,
    sellerId: row.seller_id,
    name: row.name,
    description: row.description,
    price: row.price,
    storeName: row.store_name,
    phone: row.phone,
    category: row.product_category,
    images: imagesByProduct.get(row.id) || [],
  }));
}

export function validBlobUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && /^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/i.test(url.hostname)
      && !url.username
      && !url.password;
  } catch {
    return false;
  }
}
