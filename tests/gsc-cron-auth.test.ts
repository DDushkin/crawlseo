import assert from "node:assert/strict";
import test from "node:test";

import { isAuthorizedCronRequest } from "../lib/gsc/cron-auth";

test("accepts exactly the configured bearer token", () => {
  assert.equal(isAuthorizedCronRequest("Bearer sync-secret", "sync-secret"), true);
  assert.equal(isAuthorizedCronRequest("Bearer wrong", "sync-secret"), false);
  assert.equal(isAuthorizedCronRequest(null, "sync-secret"), false);
});

test("rejects an unset or empty configured secret", () => {
  assert.equal(isAuthorizedCronRequest("Bearer sync-secret", undefined), false);
  assert.equal(isAuthorizedCronRequest("Bearer ", ""), false);
});
