"""Тесты API на настоящем PostgreSQL.

Задайте TESSERA_TEST_PG — строку подключения к серверу с правом CREATE DATABASE, например
postgresql://postgres@localhost:5432/postgres. Для каждого теста создаётся чистая база.
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
    from fastapi.testclient import TestClient
    from app.main import app
    try:
        with TestClient(app) as tc:
            yield tc
    finally:
        with psycopg.connect(ADMIN_URL, autocommit=True) as c:
            c.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')


class Api:
    def __init__(self, client, token=None):
        self.c, self.token = client, token

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


@pytest.fixture
def admin(client):
    token = Api(client).post("/api/admin/login", {"password": "test-password"})["token"]
    return Api(client, token)


@pytest.fixture
def make_team(client, admin):
    def make(condition="kanban", roles=("pm", "analyst", "finance", "engineer", "qa")):
        team = admin.post("/api/admin/teams", {"condition": condition, "label": "тест"})
        people = {}
        for i, role in enumerate(roles):
            p = Api(client, Api(client).post("/api/join", {"code": team["join_code"]})["token"])
            pid = p.post("/api/p/consent", {"agree": True, "role_slug": role, "display_name": f"Имя{i}"})
            p.pid = pid["participant_id"]
            people[role if role not in people else f"{role}2"] = p
        return team, people
    return make
