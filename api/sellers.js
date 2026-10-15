import {
  createSessionToken,
  database,
  encryptNin,
  hashPassword,
  methodNotAllowed,
  sameOrigin,
  sendJson,
  sellerProfile,
  sessionCookie,
  sessionExpiry,
  validateApplication,
} from "../lib/server.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return methodNotAllowed(res, ["POST"]);
  if (!sameOrigin(req, res)) return;

  const { fields, error } = validateApplication(req.body);
  if (error) return sendJson(res, 400, { error });

  let connection;
  try {
    const { salt, hash } = await hashPassword(fields.password);
    const ninEncrypted = encryptNin(fields.nin);
    const session = createSessionToken();
    connection = await database().getConnection();
    await connection.beginTransaction();

    const [result] = await connection.execute(
      `INSERT INTO sellers (
        store_name, address, phone, email, product_category, other_category,
        products, nin_encrypted, password_salt, password_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        fields.storeName,
        fields.address,
        fields.phone,
        fields.email,
        fields.productCategory,
        fields.otherCategory,
        fields.products,
        ninEncrypted,
        salt,
        hash,
        new Date().toISOString(),
      ],
    );
    await connection.execute(
      "INSERT INTO seller_sessions (token_hash, seller_id, expires_at) VALUES (?, ?, ?)",
      [session.hash, result.insertId, sessionExpiry()],
    );
    const [[seller]] = await connection.execute(
      "SELECT id, store_name, email, phone, product_category FROM sellers WHERE id = ?",
      [result.insertId],
    );
    await connection.commit();
    return sendJson(
      res,
      201,
      { message: "Seller account created.", seller: sellerProfile(seller) },
      { "Set-Cookie": sessionCookie(session.token) },
    );
  } catch (error) {
    if (connection) await connection.rollback();
    if (error.code === "ER_DUP_ENTRY") {
      return sendJson(res, 409, { error: "An account with this email already exists. Sign in instead." });
    }
    console.error("Seller registration failed.", error.code || error.name);
    return sendJson(res, 500, { error: "We couldn’t create your seller account. Please try again later." });
  } finally {
    connection?.release();
  }
}
