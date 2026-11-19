// Run: pnpm --filter @netmon/network-core test
import { test } from "node:test";
import assert from "node:assert/strict";
import { alertTransition, thresholdBreached, downLongEnough, shouldNotify, ruleDue, severityAtLeast, redact, alertFingerprint, nextDeviceStatus } from "./index";

const t0 = new Date("2026-01-01T00:00:00Z");
const plus = (s: number) => new Date(t0.getTime() + s * 1000);

test("no measurement never triggers or resolves an alert", () => {
  assert.equal(thresholdBreached(null, 100), null);
  assert.equal(alertTransition(null, null), "none");
  assert.equal(alertTransition("OPEN", null), "touch");
});
test("latency above threshold opens, below resolves", () => {
  assert.equal(thresholdBreached(250, 200), true);
  assert.equal(thresholdBreached(150, 200), false);
  assert.equal(alertTransition(null, true), "open");
  assert.equal(alertTransition("OPEN", false), "resolve");
});
test("a breached alert that is already open is not duplicated", () => {
  assert.equal(alertTransition("OPEN", true), "touch");
  assert.equal(alertTransition("ACKNOWLEDGED", true), "touch");
});
test("offline duration must reach the configured minutes", () => {
  assert.equal(downLongEnough(t0, plus(119), 2), false);
  assert.equal(downLongEnough(t0, plus(120), 2), true);
  assert.equal(downLongEnough(null, plus(999), 0), false);
});
test("cooldown suppresses repeat notifications", () => {
  assert.equal(shouldNotify(null, t0, 900), true);
  assert.equal(shouldNotify(t0, plus(899), 900), false);
  assert.equal(shouldNotify(t0, plus(900), 900), true);
});
test("rules respect their evaluation interval", () => {
  assert.equal(ruleDue(t0, plus(30), 60), false);
  assert.equal(ruleDue(t0, plus(60), 60), true);
});
test("severity filter for channels", () => {
  assert.equal(severityAtLeast("CRITICAL", "WARNING"), true);
  assert.equal(severityAtLeast("INFO", "WARNING"), false);
});
test("fingerprint is stable per rule and target", () => {
  assert.equal(alertFingerprint("r1", "device:d1"), alertFingerprint("r1", "device:d1"));
  assert.notEqual(alertFingerprint("r1", "device:d1"), alertFingerprint("r1", "device:d2"));
});
test("secrets are redacted from log payloads", () => {
  const out = redact({ token: "abc", nested: { password: "x", name: "ok" }, header: "Bearer abc.def" }) as Record<string, unknown>;
  assert.equal(out.token, "[redacted]");
  assert.deepEqual(out.nested, { password: "[redacted]", name: "ok" });
  assert.equal(out.header, "Bearer [redacted]");
});
test("one failed ping does not mark a device offline", () => {
  assert.equal(nextDeviceStatus("ONLINE", false, 1, 3), "ONLINE");
  assert.equal(nextDeviceStatus("ONLINE", false, 3, 3), "OFFLINE");
  assert.equal(nextDeviceStatus("OFFLINE", true, 0, 3), "ONLINE");
});
