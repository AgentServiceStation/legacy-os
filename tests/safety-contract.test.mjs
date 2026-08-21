import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoute = new URL("../app/api/projects/route.ts", import.meta.url);

test("project creation suppresses rapid duplicate retries before side effects", async () => {
  const source = await readFile(projectRoute, "utf8");

  assert.match(source, /DUPLICATE_CREATE_WINDOW_MS\s*=\s*30_000/);
  assert.match(source, /status:\s*"duplicate_suppressed"/);
  assert.match(source, /duplicateSuppressed:\s*true/);

  const suppressionIndex = source.indexOf('status: "duplicate_suppressed"');
  const insertIndex = source.indexOf("db.insert(projects).values");
  const automationIndex = source.indexOf("captureAutomationSignal(");

  assert.ok(suppressionIndex >= 0, "duplicate suppression response is present");
  assert.ok(insertIndex > suppressionIndex, "project insert happens after suppression check");
  assert.ok(
    automationIndex > suppressionIndex,
    "automation side effects happen after suppression check",
  );
});
