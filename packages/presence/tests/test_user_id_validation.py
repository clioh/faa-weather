"""Unit tests for request-supplied user id validation in web_server.py."""

import pytest

import web_server as ws


@pytest.fixture
def users_dir(monkeypatch, tmp_path):
    d = tmp_path / "face_data" / "users"
    d.mkdir(parents=True)
    monkeypatch.setattr(ws, "USERS_DIR", d)
    return d


@pytest.mark.parametrize(
    "user_id",
    ["abc", "user_1", "A-b_C", "123e4567-e89b-12d3-a456-426614174000", "x" * 64],
)
def test_safe_user_dir_accepts_valid_ids(users_dir, user_id):
    p = ws.safe_user_dir(user_id)
    assert p == (users_dir / user_id).resolve()
    assert users_dir.resolve() in p.parents


@pytest.mark.parametrize(
    "user_id",
    ["", "..", ".", "../..", "../etc", "a/b", "a\\b", "/abs", "a.b", "a b",
     "x" * 65, "a\x00b", "ü", None, 123],
)
def test_safe_user_dir_rejects_invalid_ids(users_dir, user_id):
    with pytest.raises(ValueError):
        ws.safe_user_dir(user_id)


def test_safe_user_dir_rejects_symlink_escape(users_dir, tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    (users_dir / "evil").symlink_to(outside)
    with pytest.raises(ValueError):
        ws.safe_user_dir("evil")


def test_delete_rejects_traversal_and_keeps_parent(users_dir):
    sentinel = users_dir.parent / "keep-me.txt"
    sentinel.write_bytes(b"x")
    with pytest.raises(ValueError):
        ws.delete_user_face_data("..")
    assert sentinel.exists()


def test_delete_endpoint_returns_400_for_bad_id(users_dir, internal):
    client = ws.app.test_client(); client.environ_base.update({"HTTP_" + k.upper().replace("-", "_"): v for k, v in internal.items()})
    resp = client.delete("/api/users/..%2E/face")
    assert resp.status_code in (400, 404)
    resp = client.delete("/api/users/bad.id/face")
    assert resp.status_code == 400
    resp = client.get("/api/users/bad.id/face")
    assert resp.status_code == 400
    resp = client.post("/api/start", json={"userId": "bad.id", "name": "x"})
    assert resp.status_code == 400


def test_delete_endpoint_valid_id(users_dir, internal):
    (users_dir / "u1").mkdir()
    (users_dir / "u1" / "encodings.pkl").write_bytes(b"x")
    client = ws.app.test_client(); client.environ_base.update({"HTTP_" + k.upper().replace("-", "_"): v for k, v in internal.items()})
    assert client.delete("/api/users/u1/face").status_code == 200
    assert not (users_dir / "u1").exists()
    assert client.delete("/api/users/u1/face").status_code == 404
