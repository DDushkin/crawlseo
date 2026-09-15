import assert from "node:assert/strict";
import test from "node:test";

import { Prisma } from "@prisma/client";

test("GSC V2 schema has site-scoped aggregation keys and keeps legacy models", () => {
  const models = Prisma.dmmf.datamodel.models;

  for (const modelName of [
    "Keyword",
    "Page",
    "GscDailyTotal",
    "GscQueryDaily",
    "GscPageDaily",
    "GscQueryPageDaily",
    "GscDeviceDaily",
    "GscCountryDaily",
    "GscSyncRun",
    "GscSyncLease",
  ]) {
    assert.ok(models.some((model) => model.name === modelName), `missing ${modelName} model`);
  }

  const queryPageDaily = models.find((model) => model.name === "GscQueryPageDaily");
  assert.ok(queryPageDaily, "missing GscQueryPageDaily model");
  assert.ok(
    queryPageDaily.uniqueFields.some(
      (fields) =>
        fields.length === 6 &&
        fields.every((field, index) => ["siteId", "property", "searchType", "date", "query", "url"][index] === field)
    ),
    "GscQueryPageDaily must use the site-scoped aggregation key"
  );
});
