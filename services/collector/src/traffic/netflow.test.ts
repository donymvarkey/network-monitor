// Run: pnpm --filter @netmon/collector test
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeV5 } from "./netflow.js";

const ip = (s: string) => Buffer.from(s.split(".").map(Number));
function v5(flows: [string, string, number, number][], sampling = 0) {
  const b = Buffer.alloc(24 + 48 * flows.length);
  b.writeUInt16BE(5, 0); b.writeUInt16BE(flows.length, 2); b.writeUInt16BE(sampling, 22);
  flows.forEach(([s, d, pk, by], i) => { const o = 24 + i * 48; ip(s).copy(b, o); ip(d).copy(b, o + 4); b.writeUInt32BE(pk, o + 16); b.writeUInt32BE(by, o + 20); });
  return b;
}
test("decodes addresses and byte counters from a v5 record", () => {
  const d = decodeV5(v5([["8.8.8.8", "192.168.0.21", 10, 5000]]));
  assert.deepEqual(d?.records[0], { src: "8.8.8.8", dst: "192.168.0.21", packets: 10, bytes: 5000 });
});
test("NetFlow v9 / IPFIX datagrams are not decoded as v5", () => {
  const b = Buffer.alloc(40); b.writeUInt16BE(9, 0);
  assert.equal(decodeV5(b), null);
  b.writeUInt16BE(10, 0);
  assert.equal(decodeV5(b), null);
});
test("truncated datagram is rejected", () => {
  assert.equal(decodeV5(v5([["1.1.1.1", "192.168.0.2", 1, 1]]).subarray(0, 50)), null);
});
test("sampling interval is read from the header", () => {
  assert.equal(decodeV5(v5([["1.1.1.1", "192.168.0.2", 1, 1]], 100))?.sampling, 100);
});
