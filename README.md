# Gote.ng

Gote.ng is a static storefront built with Vite and deployed on Vercel. The
seller APIs run as Vercel Node.js Functions. MySQL stores seller accounts,
sessions, products, and image metadata; Vercel Blob stores and serves product
images.

## Deploying on Vercel

1. Create a MySQL database with a managed provider reachable from Vercel. Run
   [`backend/schema.sql`](./backend/schema.sql) against it.
2. Create a **public** Vercel Blob store and connect it to the Vercel project.
   The deployment needs `BLOB_READ_WRITE_TOKEN` to authorize browser uploads;
   connecting the store adds this project environment variable in Vercel.
3. Set these project environment variables in Vercel:
   - `MYSQL_URL`: TLS-enabled MySQL connection URL. Alternatively configure
     `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, and
     `MYSQL_DATABASE`; set `MYSQL_SSL=true` for remote MySQL.
   - `GOTE_NIN_ENCRYPTION_KEY`: persistent URL-safe base64 key containing 32
     random bytes.
4. Deploy the project. Vercel runs `npm run build`, serves the generated `dist`
   directory, and deploys the handlers in `api/` as serverless functions.

Use a runtime database user restricted to the `gote_marketplace` schema with
SELECT, INSERT, UPDATE, and DELETE permissions. Apply the schema and migration
with a database administrator rather than granting DDL permissions to the
runtime user. Use a managed MySQL service that supports TLS and serverless
connection pooling. Set the encryption key once and keep it stable: changing
or losing it makes saved NINs unrecoverable.

### Existing MySQL database

Back up the database first. Before deploying the Vercel API, run
[`backend/migrate-to-vercel-blob.sql`](./backend/migrate-to-vercel-blob.sql)
against an existing database created from the former MySQL schema. It renames
the product image filename column to `blob_url` and adds the upload-tracking
table. The renamed image values are still local filenames, not Blob URLs:
upload those existing image files to the public Blob store and update each
corresponding `product_images.blob_url` with its full Blob URL before expecting
existing product images to render. The previous local image files will not be
available to Vercel automatically.

## Local development

Install Node.js 20 or newer and the project dependencies:

```powershell
npm install
```

Configure a development MySQL database, a Vercel Blob Development store, and
the same environment variables locally. Pull Vercel-linked values with
`vercel env pull .env.local`, or set the variables in your PowerShell session.
Then run:

```powershell
npx vercel dev
```

Run `npm run build` to verify the static frontend build.

## API routes

- `POST /api/sellers`: create a seller account and sign in.
- `GET`, `POST`, `DELETE /api/session`: restore, create, or end a seller
  session.
- `GET /api/seller/products`: list the signed-in seller's products.
- `GET /api/products`: list public products.
- `POST /api/products`: publish a product using images already uploaded to
  Blob.
- `POST /api/upload`: authorize seller-owned, direct-to-Blob image uploads.

Uploads are restricted to 1–10 JPEG, PNG, or WebP images, each no larger than
5 MiB. Blob uploads go directly from the browser to Vercel Blob instead of
passing through a function's request-size limit. The API verifies the seller,
upload ownership, stored size/type, and image format before publishing them.

NINs are encrypted with AES-256-GCM. Passwords use scrypt hashes, and seller
sessions use HttpOnly, SameSite=Strict cookies. There is no API for reading
private seller application records or NINs. Use HTTPS and securely manage
database credentials, Blob access, encryption keys, backups, and data-retention
policies in production.
