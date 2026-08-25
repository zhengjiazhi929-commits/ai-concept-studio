# Public test fixtures

This directory contains immutable, tracked files used by tests that exercise the
production public-path boundary. It is not runtime Episode data. Tests must not
create, update, or inspect files under `public/episodes`.
