import base64
import hashlib
import hmac
import io
import json
import os
import re
import secrets
import sqlite3
import uuid
from email.parser import BytesParser
from email.policy import default as email_policy
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from http.cookies import CookieError, SimpleCookie
from urllib.parse import urlsplit

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from PIL import Image, ImageOps, UnidentifiedImageError


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATABASE_PATH = Path(os.environ.get(
    "GOTE_DATABASE_PATH",
    str(Path(__file__).resolve().parent / "data" / "sellers.sqlite3"),
))
ALLOWED_CATEGORIES = {
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
}
MAX_REQUEST_BYTES = 16 * 1024
MAX_PRODUCT_REQUEST_BYTES = 51 * 1024 * 1024
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_PRODUCT_IMAGES = 10
SESSION_SECONDS = 12 * 60 * 60
IMAGE_DIRECTORY = Path(__file__).resolve().parent / "data" / "product-images"
Image.MAX_IMAGE_PIXELS = 20_000_000
STATIC_FILES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/images/download%20(1).png": ("images/download (1).png", "image/png"),
}


def encryption_key():
    encoded_key = os.environ.get("GOTE_NIN_ENCRYPTION_KEY", "")
    if not encoded_key:
        raise RuntimeError(
            "Set GOTE_NIN_ENCRYPTION_KEY to a URL-safe base64-encoded 32-byte key."
        )
    try:
        key = base64.urlsafe_b64decode(encoded_key.encode("ascii"))
    except (ValueError, UnicodeEncodeError) as error:
        raise RuntimeError("GOTE_NIN_ENCRYPTION_KEY is not valid URL-safe base64.") from error
    if len(key) != 32:
        raise RuntimeError("GOTE_NIN_ENCRYPTION_KEY must decode to exactly 32 bytes.")
    return key


def initialize_database():
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DATABASE_PATH) as connection:
        connection.execute("PRAGMA journal_mode = WAL")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS sellers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                store_name TEXT NOT NULL,
                address TEXT NOT NULL,
                phone TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                product_category TEXT NOT NULL,
                other_category TEXT,
                products TEXT NOT NULL,
                nin_encrypted BLOB NOT NULL,
                password_salt BLOB NOT NULL,
                password_hash BLOB NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        seller_columns = {
            column[1] for column in connection.execute("PRAGMA table_info(sellers)")
        }
        for name, column_type in (
            ("password_salt", "BLOB"),
            ("password_hash", "BLOB"),
        ):
            if name not in seller_columns:
                connection.execute(f"ALTER TABLE sellers ADD COLUMN {name} {column_type}")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS seller_sessions (
                token_hash TEXT PRIMARY KEY,
                seller_id INTEGER NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
                expires_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                seller_id INTEGER NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                description TEXT NOT NULL,
                price INTEGER NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS product_images (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
                filename TEXT NOT NULL UNIQUE,
                position INTEGER NOT NULL
            )
            """
        )


def password_hash(password, salt):
    return hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=32
    )


def seller_profile(row):
    return {
        "id": row["id"],
        "storeName": row["store_name"],
        "email": row["email"],
        "phone": row["phone"],
        "productCategory": row["product_category"],
    }


class GoteHandler(BaseHTTPRequestHandler):
    server_version = "GoteSellerAPI/1.0"

    def open_database(self):
        connection = sqlite3.connect(DATABASE_PATH, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def send_json(self, status, payload, extra_headers=None):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for name, value in (extra_headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

    def session_cookie(self, token, max_age=SESSION_SECONDS):
        cookie = f"gote_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={max_age}"
        if os.environ.get("GOTE_SECURE_COOKIES", "0") == "1":
            cookie += "; Secure"
        return cookie

    def issue_session(self, seller_id):
        token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(token.encode("ascii")).hexdigest()
        expires_at = datetime.fromtimestamp(
            datetime.now(timezone.utc).timestamp() + SESSION_SECONDS, timezone.utc
        ).isoformat()
        with self.open_database() as connection:
            connection.execute(
                "INSERT INTO seller_sessions (token_hash, seller_id, expires_at) VALUES (?, ?, ?)",
                (token_hash, seller_id, expires_at),
            )
        return token

    def current_seller(self):
        cookie_header = self.headers.get("Cookie", "")
        cookie = SimpleCookie()
        try:
            cookie.load(cookie_header)
        except CookieError:
            return None
        session_cookie = cookie.get("gote_session")
        if not session_cookie:
            return None
        token_hash = hashlib.sha256(session_cookie.value.encode("ascii", errors="ignore")).hexdigest()
        with self.open_database() as connection:
            return connection.execute(
                """
                SELECT sellers.id, sellers.store_name, sellers.email,
                       sellers.phone, sellers.product_category
                FROM seller_sessions
                JOIN sellers ON sellers.id = seller_sessions.seller_id
                WHERE seller_sessions.token_hash = ? AND seller_sessions.expires_at > ?
                """,
                (token_hash, datetime.now(timezone.utc).isoformat()),
            ).fetchone()

    def read_json(self, limit=MAX_REQUEST_BYTES):
        if self.headers.get_content_type() != "application/json":
            self.send_json(415, {"error": "Send this request as JSON."})
            return None
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_json(400, {"error": "Invalid request."})
            return None
        if content_length <= 0 or content_length > limit:
            self.send_json(413, {"error": "Request is too large or empty."})
            return None
        try:
            body = json.loads(self.rfile.read(content_length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self.send_json(400, {"error": "Invalid JSON request."})
            return None
        if not isinstance(body, dict):
            self.send_json(400, {"error": "Invalid request."})
            return None
        return body

    def require_seller(self):
        seller = self.current_seller()
        if seller is None:
            self.send_json(401, {"error": "Sign in to your seller account first."})
            return None
        return seller

    def check_same_origin(self):
        origin = self.headers.get("Origin")
        if origin and urlsplit(origin).netloc != self.headers.get("Host"):
            self.send_json(403, {"error": "Cross-origin requests are not allowed."})
            return False
        return True

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/api/session":
            seller = self.current_seller()
            if seller is None:
                self.send_json(401, {"error": "Not signed in."})
                return
            self.send_json(200, {"seller": seller_profile(seller)})
            return
        if path == "/api/seller/products":
            seller = self.require_seller()
            if seller is None:
                return
            self.send_json(200, {"products": self.load_products(seller_id=seller["id"])})
            return
        if path == "/api/products":
            self.send_json(200, {"products": self.load_products()})
            return
        if path.startswith("/media/"):
            filename = path.removeprefix("/media/")
            if not re.fullmatch(r"[0-9a-f]{32}\.webp", filename):
                self.send_error(404)
                return
            image_path = IMAGE_DIRECTORY / filename
            if not image_path.is_file():
                self.send_error(404)
                return
            body = image_path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "image/webp")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)
            return
        if path.startswith("/api/"):
            self.send_json(404, {"error": "Not found."})
            return
        static_file = STATIC_FILES.get(path)
        if static_file is None:
            self.send_error(404)
            return
        filename, content_type = static_file
        body = (PROJECT_ROOT / filename).read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def load_products(self, seller_id=None):
        query = """
            SELECT products.id, products.seller_id, products.name,
                   products.description, products.price, sellers.store_name,
                   sellers.phone, sellers.product_category
            FROM products
            JOIN sellers ON sellers.id = products.seller_id
        """
        parameters = ()
        if seller_id is not None:
            query += " WHERE products.seller_id = ?"
            parameters = (seller_id,)
        query += " ORDER BY products.created_at DESC, products.id DESC"
        with self.open_database() as connection:
            rows = connection.execute(query, parameters).fetchall()
            result = []
            for row in rows:
                images = connection.execute(
                    "SELECT filename FROM product_images WHERE product_id = ? ORDER BY position",
                    (row["id"],),
                ).fetchall()
                result.append({
                    "id": row["id"],
                    "sellerId": row["seller_id"],
                    "name": row["name"],
                    "description": row["description"],
                    "price": row["price"],
                    "storeName": row["store_name"],
                    "phone": row["phone"],
                    "category": row["product_category"],
                    "images": [f"/media/{image['filename']}" for image in images],
                })
            return result

    def do_POST(self):
        if not self.check_same_origin():
            return
        path = urlsplit(self.path).path
        if path == "/api/sellers":
            self.register_seller()
        elif path == "/api/session":
            self.login_seller()
        elif path == "/api/products":
            self.create_product()
        else:
            self.send_json(404, {"error": "Not found."})

    def do_DELETE(self):
        if not self.check_same_origin():
            return
        if urlsplit(self.path).path != "/api/session":
            self.send_json(404, {"error": "Not found."})
            return
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
        except CookieError:
            self.send_json(400, {"error": "Invalid session cookie."})
            return
        session_cookie = cookie.get("gote_session")
        if session_cookie:
            token_hash = hashlib.sha256(session_cookie.value.encode("ascii", errors="ignore")).hexdigest()
            with self.open_database() as connection:
                connection.execute("DELETE FROM seller_sessions WHERE token_hash = ?", (token_hash,))
        self.send_json(
            200,
            {"message": "Signed out."},
            {"Set-Cookie": self.session_cookie("", max_age=0)},
        )

    def register_seller(self):
        application = self.read_json()
        if application is None:
            return
        fields, validation_error = self.validate_application(application)
        if validation_error:
            self.send_json(400, {"error": validation_error})
            return
        try:
            key = encryption_key()
            nonce = os.urandom(12)
            nin_ciphertext = nonce + AESGCM(key).encrypt(
                nonce, fields["nin"].encode("ascii"), b"gote-seller-nin-v1"
            )
            salt = os.urandom(16)
            hashed_password = password_hash(fields["password"], salt)
            token = secrets.token_urlsafe(32)
            token_hash = hashlib.sha256(token.encode("ascii")).hexdigest()
            expires_at = datetime.fromtimestamp(
                datetime.now(timezone.utc).timestamp() + SESSION_SECONDS, timezone.utc
            ).isoformat()
            with self.open_database() as connection:
                connection.execute("BEGIN IMMEDIATE")
                existing = connection.execute(
                    "SELECT id FROM sellers WHERE lower(email) = lower(?)",
                    (fields["email"],),
                ).fetchone()
                if existing:
                    self.send_json(409, {"error": "An account with this email already exists. Sign in instead."})
                    return
                cursor = connection.execute(
                    """
                    INSERT INTO sellers (
                        store_name, address, phone, email, product_category,
                        other_category, products, nin_encrypted, password_salt,
                        password_hash, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        fields["storeName"], fields["address"], fields["phone"],
                        fields["email"], fields["productCategory"], fields["otherCategory"],
                        fields["products"], nin_ciphertext, salt, hashed_password,
                        datetime.now(timezone.utc).isoformat(),
                    ),
                )
                seller_id = cursor.lastrowid
                connection.execute(
                    "INSERT INTO seller_sessions (token_hash, seller_id, expires_at) VALUES (?, ?, ?)",
                    (token_hash, seller_id, expires_at),
                )
                seller = connection.execute(
                    """
                    SELECT id, store_name, email, phone, product_category
                    FROM sellers WHERE id = ?
                    """,
                    (seller_id,),
                ).fetchone()
        except (OSError, sqlite3.Error, RuntimeError):
            self.log_error("Seller registration could not be stored.")
            self.send_json(500, {"error": "We couldn’t create your seller account. Please try again later."})
            return
        self.send_json(
            201,
            {"message": "Seller account created.", "seller": seller_profile(seller)},
            {"Set-Cookie": self.session_cookie(token)},
        )

    def login_seller(self):
        credentials = self.read_json()
        if credentials is None:
            return
        email = credentials.get("email")
        password = credentials.get("password")
        if (
            not isinstance(email, str)
            or not isinstance(password, str)
            or len(email) > 254
            or len(password) > 128
        ):
            self.send_json(400, {"error": "Enter a valid email address and password."})
            return
        try:
            with self.open_database() as connection:
                seller = connection.execute(
                    """
                    SELECT id, store_name, email, phone, product_category,
                           password_salt, password_hash
                    FROM sellers WHERE lower(email) = lower(?)
                    """,
                    (email.strip(),),
                ).fetchone()
            if (
                seller is None
                or seller["password_salt"] is None
                or seller["password_hash"] is None
                or not hmac.compare_digest(
                    password_hash(password, seller["password_salt"]),
                    seller["password_hash"],
                )
            ):
                self.send_json(401, {"error": "Email or password is incorrect."})
                return
            token = self.issue_session(seller["id"])
        except (OSError, sqlite3.Error):
            self.log_error("Seller sign-in could not be completed.")
            self.send_json(500, {"error": "We couldn’t sign you in right now. Please try again later."})
            return
        self.send_json(
            200,
            {"seller": seller_profile(seller)},
            {"Set-Cookie": self.session_cookie(token)},
        )

    def parse_product_upload(self):
        content_type = self.headers.get("Content-Type", "")
        if not content_type.lower().startswith("multipart/form-data;"):
            self.send_json(415, {"error": "Upload products using the product form."})
            return None
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_json(400, {"error": "Invalid upload request."})
            return None
        if content_length <= 0 or content_length > MAX_PRODUCT_REQUEST_BYTES:
            self.send_json(413, {"error": "The product upload is too large."})
            return None
        body = self.rfile.read(content_length)
        message = BytesParser(policy=email_policy).parsebytes(
            f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode("ascii")
            + body
        )
        if not message.is_multipart():
            self.send_json(400, {"error": "Invalid product upload."})
            return None
        fields = {}
        image_parts = []
        for part in message.iter_parts():
            if part.get_content_disposition() != "form-data":
                continue
            field_name = part.get_param("name", header="content-disposition")
            filename = part.get_filename()
            value = part.get_payload(decode=True) or b""
            if field_name == "images" and filename:
                image_parts.append((filename, value))
            elif field_name in {"name", "description", "price"} and not filename:
                try:
                    fields[field_name] = value.decode(part.get_content_charset() or "utf-8").strip()
                except (LookupError, UnicodeDecodeError):
                    self.send_json(400, {"error": "Product details must be valid text."})
                    return None
        if not image_parts or len(image_parts) > MAX_PRODUCT_IMAGES:
            self.send_json(400, {"error": "Add between 1 and 10 product images."})
            return None
        for _, data in image_parts:
            if not data or len(data) > MAX_IMAGE_BYTES:
                self.send_json(413, {"error": "Each product image must be 5 MB or smaller."})
                return None
        return fields, image_parts

    @staticmethod
    def normalize_image(data):
        try:
            with Image.open(io.BytesIO(data)) as source:
                if source.format not in {"JPEG", "PNG", "WEBP"}:
                    raise ValueError("Use JPEG, PNG, or WebP product images.")
                if source.width * source.height > 20_000_000:
                    raise ValueError("Product image dimensions are too large.")
                source.verify()
            with Image.open(io.BytesIO(data)) as source:
                image = ImageOps.exif_transpose(source)
                image.load()
                if image.mode not in {"RGB", "RGBA"}:
                    image = image.convert("RGBA" if "transparency" in image.info else "RGB")
                output = io.BytesIO()
                image.save(output, format="WEBP", quality=86, method=4)
                return output.getvalue()
        except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
            raise ValueError("One of the uploaded files is not a valid image.")

    def create_product(self):
        seller = self.require_seller()
        if seller is None:
            return
        upload = self.parse_product_upload()
        if upload is None:
            return
        fields, image_parts = upload
        name = fields.get("name", "")
        description = fields.get("description", "")
        raw_price = fields.get("price", "")
        if not name or len(name) > 100 or not description or len(description) > 1000:
            self.send_json(400, {"error": "Enter a product name and a description (up to 1,000 characters)."})
            return
        if not re.fullmatch(r"[1-9][0-9]{0,9}", raw_price):
            self.send_json(400, {"error": "Enter a valid product price in Naira."})
            return
        try:
            images = [self.normalize_image(data) for _, data in image_parts]
        except ValueError as image_error:
            self.send_json(400, {"error": str(image_error)})
            return

        filenames = [f"{uuid.uuid4().hex}.webp" for _ in images]
        written_files = []
        try:
            IMAGE_DIRECTORY.mkdir(parents=True, exist_ok=True)
            with self.open_database() as connection:
                connection.execute("BEGIN IMMEDIATE")
                cursor = connection.execute(
                    """
                    INSERT INTO products (seller_id, name, description, price, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        seller["id"], name, description, int(raw_price),
                        datetime.now(timezone.utc).isoformat(),
                    ),
                )
                product_id = cursor.lastrowid
                for position, (filename, image) in enumerate(zip(filenames, images)):
                    image_path = IMAGE_DIRECTORY / filename
                    with image_path.open("xb") as image_file:
                        image_file.write(image)
                    written_files.append(image_path)
                    connection.execute(
                        "INSERT INTO product_images (product_id, filename, position) VALUES (?, ?, ?)",
                        (product_id, filename, position),
                    )
        except (OSError, sqlite3.Error):
            for image_path in written_files:
                try:
                    image_path.unlink(missing_ok=True)
                except OSError:
                    self.log_error("An incomplete product image could not be removed.")
            self.log_error("Product listing could not be stored.")
            self.send_json(500, {"error": "We couldn’t save this product. Please try again later."})
            return
        self.send_json(201, {"message": "Product added.", "productId": product_id})

    @staticmethod
    def validate_application(application):
        limits = {
            "storeName": 80,
            "address": 180,
            "phone": 20,
            "email": 254,
            "otherCategory": 80,
            "products": 500,
            "nin": 11,
            "password": 128,
            "passwordConfirm": 128,
        }
        fields = {}
        for name, limit in limits.items():
            value = application.get(name, "")
            if not isinstance(value, str):
                return None, "Check the application fields and try again."
            fields[name] = value if name in {"password", "passwordConfirm"} else value.strip()
            if len(fields[name]) > limit:
                return None, "One or more application fields are too long."

        for required in ("storeName", "address", "phone", "email", "products", "nin"):
            if not fields[required]:
                return None, "Please complete all required fields."
        if not re.fullmatch(r"[0-9]{11}", fields["nin"]):
            return None, "Enter a valid 11-digit NIN."
        if not re.fullmatch(r"\+?[0-9]{7,15}", fields["phone"]):
            return None, "Enter a valid phone number."
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", fields["email"]):
            return None, "Enter a valid email address."
        fields["email"] = fields["email"].lower()
        if len(fields["password"]) < 12:
            return None, "Choose a password with at least 12 characters."
        if fields["password"] != fields["passwordConfirm"]:
            return None, "Your passwords do not match."

        category = application.get("productCategory")
        if not isinstance(category, str) or category not in ALLOWED_CATEGORIES:
            return None, "Choose a valid product category."
        fields["productCategory"] = category
        if category == "Other" and not fields["otherCategory"]:
            return None, "Please specify your product category."
        if category != "Other":
            fields["otherCategory"] = ""
        return fields, None

    def log_error(self, message):
        print(message, flush=True)

    def log_message(self, format_string, *args):
        # Request bodies and seller information are never written to access logs.
        if urlsplit(self.path).path.startswith("/api/"):
            return
        super().log_message(format_string, *args)


def main():
    encryption_key()
    initialize_database()
    host = os.environ.get("GOTE_HOST", "127.0.0.1")
    port = int(os.environ.get("GOTE_PORT", "8000"))
    server = ThreadingHTTPServer((host, port), GoteHandler)
    print(f"Gote.ng backend listening on http://{host}:{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
