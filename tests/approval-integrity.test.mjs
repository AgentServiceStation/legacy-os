import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const approvalsRoute = new URL("../app/api/approvals/route.ts", import.meta.url);

test("design approvals require and fingerprint one exact asset", async () => {
  const source = await readFile(approvalsRoute, "utf8");
  assert.match(source, /assetId\?: string/);
  assert.match(source, /category === "design"/);
  assert.match(source, /Select the exact design file before requesting approval/);
  assert.match(source, /eq\(assets\.id, payload\.assetId\)/);
  assert.match(source, /eq\(assets\.projectId, payload\.projectId\)/);
  assert.match(source, /payloadHash: boundAsset\?\.sha256/);
  assert.match(source, /assetVersion: boundAsset\?\.version/);
  assert.match(source, /assetSha256: boundAsset\?\.sha256/);
});

test("approval decisions cannot be changed after the first decision", async () => {
  const source = await readFile(approvalsRoute, "utf8");
  assert.match(source, /existing\.status !== "pending"/);
  assert.match(source, /This approval has already been decided/);
});
