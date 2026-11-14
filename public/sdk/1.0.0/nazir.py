"""Nazir SDK 1.0.0 for Python 3.9 or newer. One file, no dependencies.

It does nothing unless Nazir signed the request. Real user traffic is never sent anywhere.
Docs: https://nazir-liard.vercel.app/docs/sdk
"""
import base64
import contextvars
import functools
import hashlib
import inspect
import json
import os
import re
import secrets
import time
import urllib.request
from datetime import datetime, timezone

VERSION = "1.0.0"
DEFAULT_URL = "https://nazir-liard.vercel.app"
MAX_VALUE = 8192
SEND_TIMEOUT = 2.0
SECRET_NAME = re.compile(r"(^|[._-])(key|api[._-]?key|token|secret|password|passwd|authorization|auth|cookie|credential)s?($|[._-])", re.I)

# ---- Ed25519 verify (RFC 8032). Uses the cryptography package when it is installed. ----
_P = 2 ** 255 - 19
_Q = 2 ** 252 + 27742317777372353535851937790883648493


def _inv(x):
    return pow(x, _P - 2, _P)


_D = -121665 * _inv(121666) % _P
_SQRT_M1 = pow(2, (_P - 1) // 4, _P)


def _add(a, b):
    x1, y1, z1, t1 = a
    x2, y2, z2, t2 = b
    A = (y1 - x1) * (y2 - x2) % _P
    B = (y1 + x1) * (y2 + x2) % _P
    C = 2 * t1 * t2 * _D % _P
    D = 2 * z1 * z2 % _P
    E, F, G, H = B - A, D - C, D + C, B + A
    return (E * F, G * H, F * G, E * H)


def _mul(s, point):
    q = (0, 1, 1, 0)
    while s > 0:
        if s & 1:
            q = _add(q, point)
        point = _add(point, point)
        s >>= 1
    return q


def _recover_x(y, sign):
    if y >= _P:
        return None
    x2 = (y * y - 1) * _inv(_D * y * y + 1)
    if x2 == 0:
        return None if sign else 0
    x = pow(x2, (_P + 3) // 8, _P)
    if (x * x - x2) % _P != 0:
        x = x * _SQRT_M1 % _P
    if (x * x - x2) % _P != 0:
        return None
    if (x & 1) != sign:
        x = _P - x
    return x


def _decompress(data):
    if len(data) != 32:
        return None
    y = int.from_bytes(data, "little")
    sign = y >> 255
    y &= (1 << 255) - 1
    x = _recover_x(y, sign)
    return None if x is None else (x, y, 1, x * y % _P)


_GY = 4 * _inv(5) % _P
_GX = _recover_x(_GY, 0)
_G = (_GX, _GY, 1, _GX * _GY % _P)


def _equal(a, b):
    return (a[0] * b[2] - b[0] * a[2]) % _P == 0 and (a[1] * b[2] - b[1] * a[2]) % _P == 0


def ed25519_verify(public, message, signature):
    try:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey  # type: ignore

        try:
            Ed25519PublicKey.from_public_bytes(public).verify(signature, message)
            return True
        except Exception:
            return False
    except ImportError:
        pass
    if len(public) != 32 or len(signature) != 64:
        return False
    a = _decompress(public)
    r = _decompress(signature[:32])
    if not a or not r:
        return False
    s = int.from_bytes(signature[32:], "little")
    if s >= _Q:
        return False
    h = int.from_bytes(hashlib.sha512(signature[:32] + public + message).digest(), "little") % _Q
    return _equal(_mul(s, _G), _add(r, _mul(h, a)))


# ---- Redaction ----
def _luhn(digits):
    total, double = 0, False
    for ch in reversed(digits):
        d = ord(ch) - 48
        if double:
            d *= 2
            if d > 9:
                d -= 9
        total += d
        double = not double
    return total % 10 == 0


def redact(text):
    """Masks emails, phones, Emirates ID, card numbers, IBAN and passport like numbers."""
    if not isinstance(text, str):
        return text
    text = re.sub(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", "[email]", text)
    text = re.sub(r"\b784[- ]?\d{4}[- ]?\d{7}[- ]?\d\b", "[emirates id]", text)
    text = re.sub(r"\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,4})?\b", "[iban]", text)

    def card(match):
        digits = re.sub(r"\D", "", match.group(0))
        return "[card]" if len(digits) >= 13 and _luhn(digits) else match.group(0)

    text = re.sub(r"\b(?:\d[ -]?){13,19}\b", card, text)
    text = re.sub(r"(?:\+|00)\d[\d ()-]{7,16}\d|\b0\d{1,2}[ -]?\d{3}[ -]?\d{4}\b", "[phone]", text)
    return re.sub(r"\b[A-Z]{1,2}\d{6,8}\b", "[passport]", text)


def _safe_json(value):
    def scrub(item):
        if isinstance(item, dict):
            return {k: scrub(v) for k, v in item.items() if not SECRET_NAME.search(str(k))}
        if isinstance(item, (list, tuple)):
            return [scrub(v) for v in item]
        return item

    if isinstance(value, str):
        text = value
    else:
        try:
            text = json.dumps(scrub(value), default=str, ensure_ascii=False)
        except Exception:
            text = str(value)
    return redact(text[:MAX_VALUE])


def _now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _headers_of(source):
    headers = getattr(source, "headers", source) or {}
    out = {}
    try:
        items = headers.items()
    except AttributeError:
        return out
    for name, value in items:
        out[str(name).lower()] = value[0] if isinstance(value, (list, tuple)) else value
    return out


def _add_inject(result, text):
    if isinstance(result, str):
        return result + "\n\n" + text
    if isinstance(result, list):
        return result + [{"title": "Note", "content": text}]
    if isinstance(result, dict):
        return dict(result, note=text)
    return result


class _NoopTurn:
    active = False

    def reply(self, text):
        return None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class Nazir:
    def __init__(self, **options):
        self._ctx = contextvars.ContextVar("nazir_turn", default=None)
        self._tools = {}
        self._seen = {}
        self._key = None
        self._ws = None
        self._url = DEFAULT_URL
        self._agent = {}
        self._described = {}
        self._public_keys = None
        self._key_cache = None
        self._inventory_sent = None
        self.dropped = 0
        if options:
            self.init(**options)

    def init(self, key=None, agent=None, url=None, public_keys=None):
        if key is not None:
            self._key = key if isinstance(key, str) else None
            match = re.match(r"^nzk_([0-9a-f]{32})_[0-9A-Za-z]{40}$", self._key or "")
            self._ws = match.group(1) if match else None
        if agent:
            self._agent = {"name": agent.get("name"), "version": agent.get("version")}
        if url:
            self._url = str(url).rstrip("/")
        if public_keys:
            self._public_keys = public_keys
        return self

    def _disabled(self):
        local = re.match(r"^http://(localhost|127\.0\.0\.1)(:\d+)?$", self._url)
        return os.environ.get("NAZIR_DISABLED") == "1" or not self._key or not self._ws or not (self._url.startswith("https://") or local)

    def _keys(self):
        if self._public_keys:
            return self._public_keys
        if self._key_cache and time.time() - self._key_cache[0] < 86400:
            return self._key_cache[1]
        try:
            with urllib.request.urlopen(self._url + "/.well-known/nazir-keys.json", timeout=SEND_TIMEOUT) as response:
                keys = [k for k in json.loads(response.read()).get("keys", []) if k.get("alg") == "Ed25519"]
            self._key_cache = (time.time(), keys)
            return keys
        except Exception:
            return self._key_cache[1] if self._key_cache else []

    def _verify(self, source):
        if self._disabled():
            return None
        h = _headers_of(source)
        signature, session, mode = h.get("x-nazir-signature"), h.get("x-nazir-session") or "", h.get("x-nazir-mode")
        try:
            turn = int(h.get("x-nazir-turn", ""))
        except ValueError:
            return None
        if not signature or not re.match(r"^ses_[0-9a-f]{32}$", session) or mode not in ("quality", "security", "connect"):
            return None
        parts = dict(p.split("=", 1) for p in str(signature).split(",") if "=" in p)
        try:
            t = int(parts.get("t", ""))
        except ValueError:
            return None
        if parts.get("ws") != self._ws or abs(time.time() - t) > 300 or not parts.get("sig"):
            return None
        replay = "%s:%d" % (session, turn)
        now = time.time()
        self._seen = {k: v for k, v in self._seen.items() if now - v < 600}
        if replay in self._seen:
            return None
        try:
            inject = base64.b64decode(h["x-nazir-inject"]).decode("utf-8") if h.get("x-nazir-inject") else ""
            sig = base64.urlsafe_b64decode(parts["sig"] + "=" * (-len(parts["sig"]) % 4))
        except Exception:
            return None
        payload = ("%d.%s.%s.%d.%s.%s" % (t, parts["ws"], session, turn, mode, _sha(inject))).encode("utf-8")
        ok = False
        for key in self._keys():
            if parts.get("kid") and key.get("kid") != parts["kid"]:
                continue
            raw = key.get("public_key", "")
            public = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))
            if ed25519_verify(public, payload, sig):
                ok = True
                break
        if not ok:
            return None
        self._seen[replay] = now
        inject_text = ""
        if inject:
            try:
                inject_text = str(json.loads(inject).get("text", ""))
            except Exception:
                inject_text = inject
        return {"session": session, "turn": turn, "mode": mode, "inject": inject_text, "injected": False, "spans": [],
                "trace": _sha(session)[:32], "root": secrets.token_hex(8), "started": _now(), "reply": None, "error": False}

    def _push(self, ctx, span):
        if len(ctx["spans"]) >= 95:
            self.dropped += 1
            return
        base = {"trace_id": ctx["trace"], "span_id": secrets.token_hex(8), "parent_span_id": ctx["root"], "turn": ctx["turn"], "status": "OK"}
        base.update(span)
        ctx["spans"].append(base)

    def _send(self, path, body):
        try:
            request = urllib.request.Request(self._url + path, data=json.dumps(body, default=str).encode("utf-8"), method="POST",
                                             headers={"authorization": "Bearer " + self._key, "content-type": "application/json"})
            with urllib.request.urlopen(request, timeout=SEND_TIMEOUT) as response:
                if response.status >= 300:
                    self.dropped += 1
        except Exception:
            self.dropped += 1

    def _inventory(self):
        d = self._described
        return {
            "model": d.get("model"),
            "tools": [{"name": t["name"], "description": t.get("description"), "changes_data": bool(t.get("changes_data")), "outside_content": bool(t.get("outside_content")),
                       "sends_out": bool(t.get("sends_out")), "action": t.get("action"), "source": "code"} for t in self._tools.values()],
            "mcp_servers": d.get("mcp_servers", []), "services": d.get("services", []), "data_stores": d.get("data_stores", []), "permissions": d.get("permissions", []),
        }

    def _flush(self, ctx):
        ended = _now()
        reply = ctx["reply"] if isinstance(ctx["reply"], str) else None
        spans = [{"trace_id": ctx["trace"], "span_id": ctx["root"], "parent_span_id": None, "turn": ctx["turn"], "kind": "invoke_agent",
                  "name": "invoke_agent %s" % (self._agent.get("name") or "agent"), "start": ctx["started"], "end": ended, "status": "ERROR" if ctx["error"] else "OK",
                  "attributes": {"gen_ai.operation.name": "invoke_agent", "gen_ai.agent.name": self._agent.get("name"), "gen_ai.conversation.id": ctx["session"], "nazir.turn": ctx["turn"], "nazir.mode": ctx["mode"]}}]
        spans += ctx["spans"]
        spans.append({"trace_id": ctx["trace"], "span_id": secrets.token_hex(8), "parent_span_id": ctx["root"], "turn": ctx["turn"], "kind": "nazir.hello", "name": "nazir.hello",
                      "start": ended, "end": ended, "status": "OK", "attributes": {"nazir.sdk.version": VERSION, "nazir.sdk.dropped": self.dropped}})
        spans.append({"trace_id": ctx["trace"], "span_id": secrets.token_hex(8), "parent_span_id": ctx["root"], "turn": ctx["turn"], "kind": "nazir.turn.end", "name": "nazir.turn.end",
                      "start": ended, "end": ended, "status": "ERROR" if ctx["error"] else "OK",
                      "attributes": {"nazir.turn": ctx["turn"], "nazir.reply": None if reply is None else _safe_json(reply), "nazir.reply.sha256": None if reply is None else _sha(reply)}})
        self._send("/api/v1/traces", {"sdk": {"name": "nazir.py", "version": VERSION}, "agent": self._agent, "session": ctx["session"], "turn": ctx["turn"], "spans": spans})
        inventory = self._inventory()
        digest = _sha(json.dumps(inventory, sort_keys=True, default=str))
        if not self._inventory_sent or (self._inventory_sent[0] != digest and time.time() - self._inventory_sent[1] > 3600):
            self._inventory_sent = (digest, time.time())
            self._send("/api/v1/inventory", {"sdk": {"name": "nazir.py", "version": VERSION}, "agent": self._agent, "inventory": inventory})

    def turn(self, source):
        """with nazir.turn(request.headers) as turn: ... turn.reply(text)"""
        try:
            ctx = self._verify(source)
        except Exception:
            ctx = None
        if not ctx:
            return _NoopTurn()
        sdk = self

        class _Turn:
            active = True
            session = ctx["session"]
            mode = ctx["mode"]

            def reply(self, text):
                ctx["reply"] = text

            def __enter__(self):
                self._token = sdk._ctx.set(ctx)
                return self

            def __exit__(self, kind, value, tb):
                ctx["error"] = kind is not None
                sdk._ctx.reset(self._token)
                try:
                    sdk._flush(ctx)
                except Exception:
                    sdk.dropped += 1
                return False

            async def __aenter__(self):
                return self.__enter__()

            async def __aexit__(self, kind, value, tb):
                return self.__exit__(kind, value, tb)

        return _Turn()

    def tool(self, name, action=None, changes_data=False, dry_run=None, outside_content=False, sends_out=False, description=None, map=None):
        """@nazir.tool("create_case", action="case_created", changes_data=True, dry_run=lambda **a: {...})"""
        self._tools[name] = {"name": name, "action": action, "changes_data": changes_data, "outside_content": outside_content, "sends_out": sends_out, "description": description}

        def decorate(fn):
            def record(ctx, args, kwargs, result, status, error_type, blocked, dry, started):
                attributes = {"gen_ai.operation.name": "execute_tool", "gen_ai.tool.name": name, "gen_ai.tool.type": "function",
                              "gen_ai.tool.call.arguments": _safe_json(kwargs if kwargs else list(args)), "gen_ai.tool.call.result": _safe_json(result),
                              "nazir.dry_run": dry, "nazir.blocked": blocked, "error.type": error_type}
                if action:
                    attributes["nazir.action.type"] = action
                if map and status == "OK":
                    try:
                        for k, v in (map(kwargs or args, result) or {}).items():
                            attributes["nazir.action." + k] = redact(v) if isinstance(v, str) else v
                    except Exception:
                        pass
                self._push(ctx, {"kind": "nazir.blocked" if blocked else "execute_tool", "name": "execute_tool " + name, "start": started, "end": _now(), "status": status, "attributes": attributes})

            def finish(ctx, result):
                if outside_content and ctx["inject"] and not ctx["injected"]:
                    ctx["injected"] = True
                    return _add_inject(result, ctx["inject"])
                return result

            if inspect.iscoroutinefunction(fn):
                @functools.wraps(fn)
                async def async_wrapped(*args, **kwargs):
                    ctx = self._ctx.get()
                    if not ctx:
                        return await fn(*args, **kwargs)
                    started, result, status, error_type, blocked, dry = _now(), None, "OK", None, False, False
                    try:
                        if changes_data:
                            if dry_run:
                                dry = True
                                result = dry_run(*args, **kwargs)
                                if inspect.isawaitable(result):
                                    result = await result
                            else:
                                blocked, result = True, {"blocked_by_test_mode": True}
                        else:
                            result = await fn(*args, **kwargs)
                        result = finish(ctx, result)
                        return result
                    except Exception as error:
                        status, error_type = "ERROR", type(error).__name__
                        raise
                    finally:
                        record(ctx, args, kwargs, result, status, error_type, blocked, dry, started)
                return async_wrapped

            @functools.wraps(fn)
            def wrapped(*args, **kwargs):
                ctx = self._ctx.get()
                if not ctx:
                    return fn(*args, **kwargs)
                started, result, status, error_type, blocked, dry = _now(), None, "OK", None, False, False
                try:
                    if changes_data:
                        if dry_run:
                            dry, result = True, dry_run(*args, **kwargs)
                        else:
                            blocked, result = True, {"blocked_by_test_mode": True}
                    else:
                        result = fn(*args, **kwargs)
                    result = finish(ctx, result)
                    return result
                except Exception as error:
                    status, error_type = "ERROR", type(error).__name__
                    raise
                finally:
                    record(ctx, args, kwargs, result, status, error_type, blocked, dry, started)
            return wrapped
        return decorate

    def action(self, kind, **data):
        ctx = self._ctx.get()
        if not ctx:
            return
        attributes = {"gen_ai.operation.name": "nazir.action", "nazir.action.type": kind}
        for k, v in data.items():
            if not SECRET_NAME.search(k):
                attributes["nazir.action." + k] = redact(v) if isinstance(v, str) else v
        now = _now()
        self._push(ctx, {"kind": "nazir.action", "name": "nazir.action " + kind, "start": now, "end": now, "attributes": attributes})

    def describe(self, **info):
        info.pop("instructions", None)
        self._described.update(info)
        return self


_default = Nazir()
init = _default.init
describe = _default.describe
tool = _default.tool
turn = _default.turn
action = _default.action
