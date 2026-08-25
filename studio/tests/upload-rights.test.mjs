import test from "node:test";
import assert from "node:assert/strict";
import {
  buildUploadRights,
  validateAssetRights
} from "../src/shared/asset-rights.mjs";

const completeInput = {
  authorOrSource: "fixture author",
  sourceUrl: null,
  license: "project-original-private-use",
  allowedUse: "private-internal-review",
  attributionRequirements: "none",
  privacyPortraitStatus: "no-identifiable-person"
};

test("新上传素材缺任一关键授权字段时 fail closed", () => {
  for (const field of [
    "authorOrSource",
    "license",
    "allowedUse",
    "attributionRequirements",
    "privacyPortraitStatus"
  ]) {
    const rights = structuredClone(completeInput);
    delete rights[field];
    assert.throws(
      () => buildUploadRights(rights, {
        actor: "human:fixture-operator",
        acquiredAt: "2026-08-25T00:00:00.000Z",
        source: "human-upload"
      }),
      (error) => error.code === "asset_rights_metadata_required"
    );
  }
});

test("素材许可证台账绑定机器计算的路径、字节与 SHA-256", () => {
  const rights = buildUploadRights(completeInput, {
    actor: "human:fixture-operator",
    acquiredAt: "2026-08-25T00:00:00.000Z",
    source: "human-upload"
  });
  const validation = validateAssetRights({
    id: "asset-v001",
    path: "episodes/test/materials/asset-v001.png",
    source: "human-upload",
    bytes: 10,
    sha256: "a".repeat(64),
    rights
  });
  assert.deepEqual(validation, { valid: true, errors: [] });

  const unknown = structuredClone(rights);
  unknown.license = "unknown";
  assert.equal(validateAssetRights({
    id: "asset-v001",
    path: "episodes/test/materials/asset-v001.png",
    source: "human-upload",
    bytes: 10,
    sha256: "a".repeat(64),
    rights: unknown
  }).valid, false);
});
