import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const schema = new URL("../db/lifecycle-schema.ts", import.meta.url);
const migration = new URL("../drizzle/0004_tattoo_lifecycle.sql", import.meta.url);
const dbIndex = new URL("../db/index.ts", import.meta.url);

test("tattoo lifecycle adds session finance and healing records", async () => {
  const source = await readFile(schema, "utf8");
  assert.match(source, /export const tattooSessions/);
  assert.match(source, /machineSetupJson/);
  assert.match(source, /needleSetupJson/);
  assert.match(source, /voltageMinMv/);
  assert.match(source, /export const financialEvents/);
  assert.match(source, /eventType/);
  assert.match(source, /amountCents/);
  assert.match(source, /idempotencyKey/);
  assert.match(source, /export const healingRecords/);
  assert.match(source, /touchupRequired/);
  assert.match(source, /qualityBps/);
});

test("D1 runtime registers lifecycle schema", async () => {
  const source = await readFile(dbIndex, "utf8");
  assert.match(source, /import \* as lifecycleSchema from "\.\/lifecycle-schema"/);
  assert.match(source, /\.\.\.coreSchema, \.\.\.lifecycleSchema/);
});

test("migration creates all tattoo lifecycle tables and key indexes", async () => {
  const sql = await readFile(migration, "utf8");
  assert.match(sql, /CREATE TABLE `tattoo_sessions`/);
  assert.match(sql, /CREATE TABLE `financial_events`/);
  assert.match(sql, /CREATE TABLE `healing_records`/);
  assert.match(sql, /tattoo_sessions_project_number_uq/);
  assert.match(sql, /financial_events_idempotency_uq/);
  assert.match(sql, /FOREIGN KEY \(`session_id`\) REFERENCES `tattoo_sessions`/);
});
