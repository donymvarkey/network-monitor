import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSession, canWrite } from "./auth-policy";

const user = { id: "u1", role: "ADMIN" as const, sessionVersion: 2, disabled: false };
const now = 1_000_000;
const s = { userId: "u1", role: "ADMIN" as const, ver: 2, iat: now - 100, seen: now - 10 };

test("valid session passes and takes the role from the database", () => {
  const v = checkSession({ ...s, role: "ADMIN" }, { ...user, role: "VIEWER" }, now, 3600, 600);
  assert.deepEqual(v.ok && v.role, "VIEWER");
});
test("no session / no iat", () => { assert.equal(checkSession({}, user, now, 3600, 600).ok, false); });
test("deleted user is rejected", () => { assert.deepEqual(checkSession(s, null, now, 3600, 600), { ok: false, reason: "REVOKED" }); });
test("disabled user is rejected", () => { assert.deepEqual(checkSession(s, { ...user, disabled: true }, now, 3600, 600), { ok: false, reason: "DISABLED" }); });
test("sign-out-everywhere (version bump) revokes old cookies", () => { assert.deepEqual(checkSession(s, { ...user, sessionVersion: 3 }, now, 3600, 600), { ok: false, reason: "REVOKED" }); });
test("absolute expiry", () => { assert.deepEqual(checkSession({ ...s, iat: now - 3601 }, user, now, 3600, 600), { ok: false, reason: "EXPIRED" }); });
test("idle expiry", () => { assert.deepEqual(checkSession({ ...s, seen: now - 601 }, user, now, 3600, 600), { ok: false, reason: "IDLE" }); });
test("only admins can write", () => { assert.equal(canWrite("ADMIN"), true); assert.equal(canWrite("VIEWER"), false); });
