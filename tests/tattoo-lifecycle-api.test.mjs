import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sessions = new URL("../app/api/sessions/route.ts", import.meta.url);
const finance = new URL("../app/api/finance/route.ts", import.meta.url);
const healing = new URL("../app/api/healing/route.ts", import.meta.url);

test("tattoo sessions preserve technical context without test-data learning", async () => {
  const source = await readFile(sessions, "utf8");
  assert.match(source, /machineSetups/);
  assert.match(source, /needleSetups/);
  assert.match(source, /inkSetups/);
  assert.match(source, /voltageMinMv/);
  assert.match(source, /voltageMaxMv/);
  assert.match(source, /project\.status === "test"/);
  assert.match(source, /if \(!isTestData\)/);
});

test("financial events separate planning values from realized money", async () => {
  const source = await readFile(finance, "utf8");
  assert.match(source, /"estimate"/);
  assert.match(source, /"quote"/);
  assert.match(source, /"deposit_paid"/);
  assert.match(source, /"payment"/);
  assert.match(source, /"refund"/);
  assert.match(source, /netReceivedCents/);
  assert.match(source, /externalMoneyMoved: false/);
  assert.match(source, /idempotencyKey/);
});

test("healing records create outcome evidence without confusing outcome score and evidence quality", async () => {
  const source = await readFile(healing, "utf8");
  assert.match(source, /touchupRequired/);
  assert.match(source, /healing\.outcome:/);
  assert.match(source, /const evidenceQualityBps/);
  assert.match(source, /qualityBps: evidenceQualityBps/);
  assert.match(source, /hasPhoto: Boolean\(payload\.assetId\)/);
});
