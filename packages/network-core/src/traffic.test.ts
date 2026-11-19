// Run: pnpm --filter @netmon/network-core test   (node:test via tsx)
import { test } from "node:test";
import assert from "node:assert/strict";
import { counterDelta, guessInterfaceRole } from "./index";

test("counter reset yields no sample instead of zero or a negative value", () => {
  assert.equal(counterDelta(5_000_000n, 1_000n, 60, 100), null);
});
test("normal delta is returned as bytes", () => {
  assert.equal(counterDelta(1_000n, 61_000n, 60, 100), 60_000n);
});
test("32-bit counter wrap is handled", () => {
  assert.equal(counterDelta(0xFFFFFF00n, 0x100n, 10, 1000, 32), 0x200n);
});
test("delta faster than the link speed is rejected", () => {
  // 100 Mbit/s for 10 s is at most ~125 MB; 1 GB is impossible
  assert.equal(counterDelta(0n, 1_000_000_000n, 10, 100), null);
});
test("only WAN-like names are WAN; unknown names never count toward totals", () => {
  assert.equal(guessInterfaceRole("wan0"), "WAN");
  assert.equal(guessInterfaceRole("ppp0"), "WAN");
  assert.equal(guessInterfaceRole("br-lan"), "LAN");
  assert.equal(guessInterfaceRole("lo"), "OTHER");
  assert.equal(guessInterfaceRole("xyz9"), "OTHER");
});
