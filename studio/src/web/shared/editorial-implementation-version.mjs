// Browser-safe version identity shared by the producer and approval presenters.
export const EDITORIAL_IMPLEMENTATION_VERSION = "editorial-code-implementation-v2";

const DISPLAY_VERSIONS = Object.freeze([
  "editorial-code-implementation-v1",
  EDITORIAL_IMPLEMENTATION_VERSION
]);

// Display compatibility only: this neither validates resource bytes nor grants
// execution/approval authority, and never upgrades a historical v1 record.
export function editorialImplementationDisplaySupported(value) {
  return value?.componentId === "EditorialMotionPreview"
    && DISPLAY_VERSIONS.includes(value?.schemaVersion);
}
