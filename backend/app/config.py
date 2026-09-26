import logging
import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = BACKEND_DIR.parent

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://tessera:tessera@localhost:5432/tessera")
SCHEMA_DIR = Path(os.environ.get("TESSERA_SCHEMA_DIR", REPO_DIR / "schema"))
CONTENT_DIR = Path(os.environ.get("TESSERA_CONTENT_DIR", BACKEND_DIR))

ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
if not ADMIN_PASSWORD:
    ADMIN_PASSWORD = "tessera"
    logging.getLogger("tessera").warning(
        "ADMIN_PASSWORD не задан — используется пароль по умолчанию 'tessera'. Задайте его в .env"
    )
