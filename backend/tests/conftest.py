"""Тесты API на настоящем PostgreSQL.

Задайте TESSERA_TEST_PG — строку подключения к серверу с правом CREATE DATABASE, например
postgresql://postgres@localhost:5432/postgres. Для каждого теста создаётся чистая база.
Фоновый цикл в тестах выключен: его такты вызываются явно.
"""

import os
import sys
import uuid
from pathlib import Path

import psycopg
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # пакет app при запуске из корня

ADMIN_URL = os.environ.get("TESSERA_TEST_PG")
os.environ.setdefault("ADMIN_PASSWORD", "test-password")
os.environ["TESSERA_WORKER"] = "0"


@pytest.fixture
def client():
    if not ADMIN_URL:
        pytest.skip("TESSERA_TEST_PG не задан")
    name = f"tessera_test_{uuid.uuid4().hex[:8]}"
    with psycopg.connect(ADMIN_URL, autocommit=True) as c:
        c.execute(f'CREATE DATABASE "{name}"')
    url = ADMIN_URL.rsplit("/", 1)[0] + f"/{name}"
    from app import config
    config.DATABASE_URL = url
    config.WORKER = False
    from fastapi.testclient import TestClient
    from app.main import app
    try:
        with TestClient(app) as tc:
            yield tc
    finally:
        with psycopg.connect(ADMIN_URL, autocommit=True) as c:
            c.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


@pytest.fixture
def sql(client):
    """Прямой доступ к базе теста (для перемотки времени и проверок)."""
    from app import config

    def run(query, params=None, fetch=True):
        with psycopg.connect(config.DATABASE_URL, autocommit=True) as c:
            cur = c.execute(query, params)
            return cur.fetchall() if fetch and cur.description else None
    return run


class Api:
    def __init__(self, client, token=None):
        self.c, self.token = client, token
        self.pid = None

    def _h(self):
        return {"Authorization": f"Bearer {self.token}"} if self.token else {}

    def get(self, path, status=200):
        r = self.c.get(path, headers=self._h())
        assert r.status_code == status, r.text
        return r.json() if r.headers.get("content-type", "").startswith("application/json") else r

    def post(self, path, body=None, status=200):
        r = self.c.post(path, json=body or {}, headers=self._h())
        assert r.status_code == status, r.text
        return r.json()

    def patch(self, path, body, status=200):
        r = self.c.patch(path, json=body, headers=self._h())
        assert r.status_code == status, r.text
        return r.json()

    def put(self, path, body, status=200):
        r = self.c.put(path, json=body, headers=self._h())
        assert r.status_code == status, r.text
        return r.json()

    def delete(self, path, status=200):
        r = self.c.delete(path, headers=self._h())
        assert r.status_code == status, r.text
        return r.json()


@pytest.fixture
def admin(client):
    token = Api(client).post("/api/admin/login", {"password": "test-password"})["token"]
    return Api(client, token)


ROLES = ("pm", "analyst", "finance", "engineer", "qa")


@pytest.fixture
def make_team(client, admin):
    def make(condition="kanban", roles=ROLES, protocol="standard"):
        team = admin.post("/api/admin/teams", {"condition": condition, "label": "тест", "protocol_id": protocol})
        people = {}
        for i, role in enumerate(roles):
            p = Api(client, Api(client).post("/api/join", {"code": team["join_code"]})["token"])
            p.pid = p.post("/api/p/consent", {"agree": True, "role_slug": role, "display_name": f"Имя{i}"})["participant_id"]
            people[role if role not in people else f"{role}2"] = p
        team["url"] = f"/api/admin/sessions/{team['team_id']}/{team['session_id']}"
        return team, people
    return make


@pytest.fixture
def phase(admin):
    def go(team, name):
        admin.post(team["url"] + "/phase", {"phase": name})
    return go
