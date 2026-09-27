import logging
import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = BACKEND_DIR.parent

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://tessera:tessera@localhost:5432/tessera")
SCHEMA_DIR = Path(os.environ.get("TESSERA_SCHEMA_DIR", REPO_DIR / "schema"))
CONTENT_DIR = Path(os.environ.get("TESSERA_CONTENT_DIR", BACKEND_DIR))

# Адрес, по которому платформу открывают участники (для QR-кода на проекторе).
PUBLIC_URL = os.environ.get("PUBLIC_URL", "").rstrip("/")
# Публичная кнопка «Попробовать одному» на главной.
PUBLIC_DEMO = os.environ.get("TESSERA_PUBLIC_DEMO", "1") not in ("0", "false", "no")
# Фоновый цикл: таймлайн протоколов, боты, достижения, подсказки. В тестах выключается.
WORKER = os.environ.get("TESSERA_WORKER", "1") not in ("0", "false", "no")

ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
if not ADMIN_PASSWORD:
    ADMIN_PASSWORD = "tessera"
    logging.getLogger("tessera").warning(
        "ADMIN_PASSWORD не задан — используется пароль по умолчанию 'tessera'. Задайте его в .env"
    )
