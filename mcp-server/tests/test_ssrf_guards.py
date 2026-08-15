"""Tests for the SSRF guards added around the HTTP transport auth work.

Covers _is_blocked_host (the host/IP blocklist) and _fetch_public_url
(the extract_source_prompt legacy fallback's redirect-safe fetcher).
"""

from __future__ import annotations

import httpx
import pytest

from hypervault_mcp import server as srv


@pytest.mark.parametrize(
    ("hostname", "expected"),
    [
        ("127.0.0.1", True),
        ("169.254.169.254", True),  # cloud metadata endpoint
        ("localhost", True),
        ("sub.localhost", True),
        ("service.internal", True),
        ("10.0.0.5", True),
        ("192.168.1.1", True),
        ("172.16.0.1", True),
        ("172.32.0.1", False),  # just outside the 172.16/12 private range
        ("example.com", False),
        ("hypervault.store", False),
        ("::1", True),
        ("fe80::1", True),
        ("", True),
    ],
)
def test_is_blocked_host(hostname: str, expected: bool) -> None:
    assert srv._is_blocked_host(hostname) is expected


class FakeResponse:
    def __init__(self, status_code: int, headers: dict[str, str] | None = None, text: str = ""):
        self.status_code = status_code
        self.headers = headers or {}
        self.text = text

    @property
    def is_redirect(self) -> bool:
        return self.status_code in (301, 302, 303, 307, 308)

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("error", request=None, response=self)  # type: ignore[arg-type]


def test_fetch_public_url_blocks_redirect_to_private_address(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []

    def fake_get(url: str, follow_redirects: bool = False, timeout: float = 30.0) -> FakeResponse:
        calls.append(url)
        assert url == "https://example.com/page"
        return FakeResponse(302, {"location": "http://127.0.0.1:9/internal"})

    monkeypatch.setattr(httpx, "get", fake_get)

    with pytest.raises(srv.HyperVaultError, match="private or local"):
        srv._fetch_public_url("https://example.com/page")

    # Must never have followed the redirect to the internal target.
    assert calls == ["https://example.com/page"]


def test_fetch_public_url_follows_same_host_redirect(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []

    def fake_get(url: str, follow_redirects: bool = False, timeout: float = 30.0) -> FakeResponse:
        calls.append(url)
        if url == "https://example.com/redirect":
            return FakeResponse(302, {"location": "/final"})
        if url == "https://example.com/final":
            return FakeResponse(200, {}, '<meta name="hypervault-source-prompt" content="hi">')
        raise AssertionError(f"unexpected url {url}")

    monkeypatch.setattr(httpx, "get", fake_get)

    response = srv._fetch_public_url("https://example.com/redirect")
    assert response.status_code == 200
    assert "hypervault-source-prompt" in response.text
    assert calls == ["https://example.com/redirect", "https://example.com/final"]


def test_fetch_public_url_rejects_non_http_scheme() -> None:
    with pytest.raises(srv.HyperVaultError, match="Only http"):
        srv._fetch_public_url("file:///etc/passwd")


def test_fetch_public_url_gives_up_after_too_many_redirects(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_get(url: str, follow_redirects: bool = False, timeout: float = 30.0) -> FakeResponse:
        return FakeResponse(302, {"location": url + "x"})

    monkeypatch.setattr(httpx, "get", fake_get)

    with pytest.raises(srv.HyperVaultError, match="Too many redirects"):
        srv._fetch_public_url("https://example.com/loop")


def test_http_auth_provider_requires_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("HYPERVAULT_API_KEY", raising=False)
    assert srv._http_auth_provider() is None


def test_http_auth_provider_builds_verifier_from_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HYPERVAULT_API_KEY", "hv_test_key")
    provider = srv._http_auth_provider()
    assert provider is not None
    assert "hv_test_key" in provider.tokens
