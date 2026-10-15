# Gote.ng seller accounts and product backend

Seller accounts and products are stored in SQLite at
`backend/data/sellers.sqlite3` by default. The database and product image
directory are not served as static files. NIN values are encrypted with
AES-256-GCM before storage and are never included in API responses or request
logs. Seller passwords are stored as salted scrypt hashes.

## Run locally

Requires Python 3.10+.

Install the backend dependencies:

```powershell
python -m pip install -r requirements.txt
```

Create an encryption key and start the server in PowerShell:

```powershell
$env:GOTE_NIN_ENCRYPTION_KEY = python -c "import base64,secrets; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())"
python backend/server.py
```

Keep the encryption key safe and persistent. Losing it makes stored NIN values
unrecoverable; changing it prevents decrypting records encrypted by the old key.
Do not commit the key or the SQLite database.

The local server listens on `http://127.0.0.1:8000` and serves the storefront
and its API from the same origin.

## Seller accounts and product listings

- `POST /api/sellers` creates a seller account and signs the seller in.
- `POST /api/session` signs in; `GET /api/session` restores the current
  seller's session; `DELETE /api/session` signs out.
- `GET /api/seller/products` returns the signed-in seller's products.
- `POST /api/products` adds a product for the signed-in seller.
- `GET /api/products` returns public product listings for the storefront.
- `GET /media/<generated-name>.webp` serves processed product images.

Product uploads require between 1 and 10 JPEG, PNG, or WebP images, each no
larger than 5 MiB. The server verifies and re-encodes accepted images as WebP
using generated filenames. Seller sessions use HttpOnly, SameSite=Strict
cookies and expire after 12 hours. Set `GOTE_SECURE_COOKIES=1` when serving over
HTTPS.

There is no API for reading NIN values or private seller application records.
Add an authenticated, audited admin workflow before providing staff access to
seller records.

## Production requirements

Use HTTPS, securely managed environment secrets, encrypted backups, restricted
database access, retention/deletion rules, and an authenticated staff workflow
before collecting real seller applications or NINs. Configure
`GOTE_DATABASE_PATH`, `GOTE_HOST`, and `GOTE_PORT` for the deployment. The
included server is a small starting point, not a substitute for a production
deployment review.
