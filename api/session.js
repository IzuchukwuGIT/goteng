import {
  createSessionToken,
  currentSeller,
  database,
  hashPassword,
  methodNotAllowed,
  parseCookie,
  passwordsMatch,
  sameOrigin,
  sendJson,
  sellerProfile,
  sessionCookie,
  sessionExpiry,
} from "../lib/server.js";
import { createHash } from "node:crypto";

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const seller = await currentSeller(req);
      if (!seller) return sendJson(res, 401, { error: "Not signed in." });
      return sendJson(res, 200, { seller: sellerProfile(seller) });
    }
    if (req.method === "POST") {
      if (!sameOrigin(req, res)) return;
      const { email, password } = req.body || {};
      if (typeof email !== "string" || typeof password !== "string"
        || email.length > 254 || password.length > 128) {
        return sendJson(res, 400, { error: "Enter a valid email address and password." });
      }
      const [rows] = await database().execute(
        `SELECT id, store_name, email, phone, product_category,
                password_salt, password_hash
         FROM sellers WHERE email = ?`,
        [email.trim().toLowerCase()],
      );
      const seller = rows[0];
      if (!seller || !await passwordsMatch(password, seller.password_salt, seller.password_hash)) {
        return sendJson(res, 401, { error: "Email or password is incorrect." });
      }
      const session = createSessionToken();
      await database().execute(
        "INSERT INTO seller_sessions (token_hash, seller_id, expires_at) VALUES (?, ?, ?)",
        [session.hash, seller.id, sessionExpiry()],
      );
      return sendJson(
        res,
        200,
        { seller: sellerProfile(seller) },
        { "Set-Cookie": sessionCookie(session.token) },
      );
    }
    if (req.method === "DELETE") {
      if (!sameOrigin(req, res)) return;
      const token = parseCookie(req, "gote_session");
      if (token) {
        const tokenHash = createHash("sha256").update(token).digest("hex");
        await database().execute("DELETE FROM seller_sessions WHERE token_hash = ?", [tokenHash]);
      }
      return sendJson(
        res,
        200,
        { message: "Signed out." },
        { "Set-Cookie": sessionCookie("", 0) },
      );
    }
    return methodNotAllowed(res, ["GET", "POST", "DELETE"]);
  } catch (error) {
    console.error("Seller session request failed.", error.code || error.name);
    return sendJson(res, 500, { error: "We couldn’t complete the sign-in request. Please try again later." });
  }
}
