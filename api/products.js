import { head } from "@vercel/blob";
import sharp from "sharp";
import {
  currentSeller,
  database,
  getPublicProducts,
  methodNotAllowed,
  sameOrigin,
  sendJson,
  validBlobUrl,
} from "../lib/server.js";

const allowedContentTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxImageBytes = 5 * 1024 * 1024;
const maxProductRequestBytes = 20 * 1024;

function validateProduct(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Invalid product details." };
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const price = typeof body.price === "string" || typeof body.price === "number"
    ? String(body.price)
    : "";
  const images = body.images;
  if (!name || name.length > 100 || !description || description.length > 1000) {
    return { error: "Enter a product name and a description (up to 1,000 characters)." };
  }
  if (!/^[1-9][0-9]{0,9}$/.test(price)) return { error: "Enter a valid product price in Naira." };
  if (!Array.isArray(images) || images.length < 1 || images.length > 10
    || images.some((image) => !validBlobUrl(image)) || new Set(images).size !== images.length) {
    return { error: "Add between 1 and 10 valid product images." };
  }
  return { fields: { name, description, price: Number(price), images } };
}

async function verifyBlobImage(url, sellerId, pending) {
  const blob = await head(url);
  if (blob.url !== url
    || blob.pathname !== pending.pathname
    || blob.size !== pending.size
    || blob.size < 1
    || blob.size > maxImageBytes
    || blob.contentType !== pending.content_type
    || !allowedContentTypes.has(blob.contentType)
    || !blob.pathname.startsWith(`products/${sellerId}/`)) {
    throw new Error("An uploaded image is invalid or no longer available.");
  }

  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("An uploaded image could not be read.");
  const image = Buffer.from(await response.arrayBuffer());
  if (image.length > maxImageBytes) throw new Error("Each image must be 5 MB or smaller.");
  const metadata = await sharp(image, { limitInputPixels: 20_000_000 }).metadata();
  if (!["jpeg", "png", "webp"].includes(metadata.format)) {
    throw new Error("Use JPEG, PNG or WebP product images.");
  }
  return true;
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      return sendJson(res, 200, { products: await getPublicProducts() });
    }
    if (req.method !== "POST") return methodNotAllowed(res, ["GET", "POST"]);
    if (!sameOrigin(req, res)) return;
    const seller = await currentSeller(req);
    if (!seller) return sendJson(res, 401, { error: "Sign in to your seller account first." });
    const contentLength = Number(req.headers["content-length"] || 0);
    if (contentLength > maxProductRequestBytes) {
      return sendJson(res, 413, { error: "The product details are too large." });
    }
    const { fields, error } = validateProduct(req.body);
    if (error) return sendJson(res, 400, { error });

    const placeholders = fields.images.map(() => "?").join(", ");
    const [pendingImages] = await database().execute(
      `SELECT blob_url, seller_id, pathname, content_type, size
       FROM pending_product_images
       WHERE seller_id = ? AND blob_url IN (${placeholders})`,
      [seller.id, ...fields.images],
    );
    if (pendingImages.length !== fields.images.length) {
      return sendJson(res, 400, { error: "Upload your selected images again before adding the product." });
    }
    const pendingByUrl = new Map(pendingImages.map((image) => [image.blob_url, image]));
    try {
      await Promise.all(fields.images.map((url) =>
        verifyBlobImage(url, seller.id, pendingByUrl.get(url))
      ));
    } catch (error) {
      console.warn("Product image validation failed.", error.message);
      return sendJson(res, 400, { error: error.message });
    }

    const connection = await database().getConnection();
    let productId;
    try {
      await connection.beginTransaction();
      const [result] = await connection.execute(
        `INSERT INTO products (seller_id, name, description, price, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [seller.id, fields.name, fields.description, fields.price, new Date().toISOString()],
      );
      productId = result.insertId;
      for (const [position, url] of fields.images.entries()) {
        await connection.execute(
          "INSERT INTO product_images (product_id, blob_url, position) VALUES (?, ?, ?)",
          [productId, url, position],
        );
      }
      await connection.execute(
        `DELETE FROM pending_product_images
         WHERE seller_id = ? AND blob_url IN (${placeholders})`,
        [seller.id, ...fields.images],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
    return sendJson(res, 201, { message: "Product added.", productId });
  } catch (error) {
    console.error("Product request failed.", error.code || error.name);
    if (error.message === "The requested blob does not exist.") {
      return sendJson(res, 400, { error: "An uploaded image could not be found. Upload it again." });
    }
    return sendJson(res, 500, { error: "Could not complete the product request right now." });
  }
}
