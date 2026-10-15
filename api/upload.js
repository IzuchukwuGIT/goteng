import { handleUpload } from "@vercel/blob/client";
import { database, currentSeller, sendJson } from "../lib/server.js";

const allowedContentTypes = ["image/jpeg", "image/png", "image/webp"];
const maxImageBytes = 5 * 1024 * 1024;

export default async function handler(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." }, { Allow: "POST" });

  try {
    const result = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const seller = await currentSeller(req);
        if (!seller) throw new Error("Sign in to your seller account first.");
        let uploadClaims;
        try {
          uploadClaims = JSON.parse(clientPayload || "{}");
        } catch {
          throw new Error("Invalid upload request.");
        }
        if (String(uploadClaims.sellerId) !== String(seller.id)
          || !pathname.startsWith(`products/${seller.id}/`)
          || pathname.length > 512) {
          throw new Error("You can only upload images to your own seller account.");
        }
        return {
          addRandomSuffix: true,
          allowedContentTypes,
          maximumSizeInBytes: maxImageBytes,
          validUntil: Date.now() + 10 * 60 * 1000,
          tokenPayload: JSON.stringify({ sellerId: String(seller.id) }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        let claims;
        try {
          claims = JSON.parse(tokenPayload || "{}");
        } catch {
          throw new Error("Invalid upload authorization.");
        }
        const sellerId = Number(claims.sellerId);
        if (!Number.isSafeInteger(sellerId)
          || sellerId < 1
          || !blob.pathname.startsWith(`products/${sellerId}/`)
          || !allowedContentTypes.includes(blob.contentType)
          || blob.size > maxImageBytes) {
          throw new Error("The uploaded image does not match its authorization.");
        }
        await database().execute(
          `INSERT INTO pending_product_images
            (blob_url, seller_id, pathname, content_type, size)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE seller_id = VALUES(seller_id),
             pathname = VALUES(pathname), content_type = VALUES(content_type),
             size = VALUES(size)`,
          [blob.url, sellerId, blob.pathname, blob.contentType, blob.size],
        );
      },
    });
    return sendJson(res, 200, result);
  } catch (error) {
    console.error("Blob upload authorization failed.", error.code || error.name);
    return sendJson(res, 400, { error: "Could not authorize this image upload." });
  }
}
