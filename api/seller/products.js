import {
  currentSeller,
  getSellerProducts,
  methodNotAllowed,
  sendJson,
} from "../../lib/server.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
  try {
    const seller = await currentSeller(req);
    if (!seller) return sendJson(res, 401, { error: "Sign in to your seller account first." });
    return sendJson(res, 200, { products: await getSellerProducts(seller.id) });
  } catch (error) {
    console.error("Seller product list request failed.", error.code || error.name);
    return sendJson(res, 500, { error: "Could not load your products right now." });
  }
}
