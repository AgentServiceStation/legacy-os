import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const portalRoute = new URL("../app/api/portal/route.ts", import.meta.url);

test("client messages suppress rapid duplicate retries before side effects", async () => {
  const source = await readFile(portalRoute, "utf8");
  assert.match(source, /DUPLICATE_CREATE_WINDOW_MS\s*=\s*30_000/);
  assert.match(source, /senderType, "client"/);
  assert.match(source, /status:\s*"duplicate_suppressed"/);
  assert.match(source, /duplicateSuppressed:\s*true/);
});

test("test portal activity remains auditable but does not feed automation", async () => {
  const source = await readFile(portalRoute, "utf8");
  assert.match(source, /client\.status === "test"/);
  assert.match(source, /project\?\.status === "test"/);
  assert.match(source, /approval\.projectStatus === "test"/);
  assert.match(source, /if \(!isTestData\) \{\s*await captureAutomationSignal/s);
});

test("client approval decisions are pending-only and retain artifact identity", async () => {
  const source = await readFile(portalRoute, "utf8");
  assert.match(source, /approval\.status !== "pending"/);
  assert.match(source, /eq\(approvals\.status, "pending"\)/);
  assert.match(source, /payloadHash: approvals\.payloadHash/);
  assert.match(source, /payloadHash: approval\.payloadHash/);
});
