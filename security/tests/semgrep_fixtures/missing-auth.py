# SemGrep --test fixture for rules/missing-auth.yaml.
# Annotation lines below assert expected matches: a handler expected to match
# carries the rule-id annotation above it; a handler expected NOT to match
# carries the negative annotation. This proves the rule fires on unauthenticated
# state-changing routes and stays silent on authenticated ones and read-only GETs.
# (Prose here deliberately avoids the literal annotation tokens so semgrep's
#  --test parser does not read this header as an expectation.)
#
# Run via tests/test_semgrep_rule.py, or directly:
#   semgrep --test --config device-service/rules/missing-auth.yaml \
#       security/tests/semgrep_fixtures/missing-auth.py

from flask import Flask, request, jsonify

app = Flask(__name__)


def require_token(fn):
    return fn


def require_auth(*a, **k):
    def deco(fn):
        return fn
    return deco


# --- SHOULD FIRE: state-changing routes with no auth guard ------------------

# ruleid: flask-missing-auth-decorator
@app.post("/device/command")
def vulnerable_post():
    return jsonify(ok=True)


# ruleid: flask-missing-auth-decorator
@app.put("/device/config")
def vulnerable_put():
    return jsonify(ok=True)


# ruleid: flask-missing-auth-decorator
@app.delete("/device/record")
def vulnerable_delete():
    return jsonify(ok=True)


# --- SHOULD NOT FIRE: authenticated state-changing routes -------------------

# ok: flask-missing-auth-decorator
@app.post("/device/command_patched")
@require_token
def patched_bare_decorator():
    return jsonify(ok=True)


# ok: flask-missing-auth-decorator
@app.post("/device/command_auth_call")
@require_auth("operator")
def patched_call_decorator():
    return jsonify(ok=True)


# --- SHOULD NOT FIRE: read-only GET is not a critical function --------------

# ok: flask-missing-auth-decorator
@app.get("/device/status")
def read_only_status():
    return jsonify(ok=True)
