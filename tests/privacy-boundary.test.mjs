import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const portalRoute = new URL("../app/api/portal/route.ts", import.meta.url);
const filesRoute = new URL("../app/api/files/route.ts", import.meta.url);
const clientsRoute = new URL("../app/api/clients/route.ts", import.meta.url);

test("client portal uses an explicit public DTO instead of raw owner records", async () => {
  const source = await readFile(portalRoute, "utf8");
  assert.match(source, /const publicClient =/);
  assert.match(source, /const publicProjects =/);
  assert.match(source, /notes: null/);
  assert.match(source, /summary: null/);
  assert.match(source, /nextAction: null/);
  assert.match(source, /sourceType, "client_upload"/);
  assert.match(source, /client: publicClient/);
  assert.match(source, /projects: publicProjects/);
});

test("client cannot download private owner uploads by asset id", async () => {
  const source = await readFile(filesRoute, "utf8");
  assert.match(source, /row\.sourceType !== "client_upload"/);
  assert.match(source, /This file has not been shared with the client/);
});

test("client creation does not require an invented surname", async () => {
  const source = await readFile(clientsRoute, "utf8");
  assert.match(source, /displayName\?: string/);
  assert.match(source, /const lastName = payload\.lastName\?\.trim\(\) \|\| ""/);
  assert.match(source, /A client name or temporary label is required/);
  assert.doesNotMatch(source, /First and last name are required/);
});
