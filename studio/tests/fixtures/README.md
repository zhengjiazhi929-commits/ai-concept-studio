# Test fixtures

Files in this directory are immutable, tracked test inputs. Tests must read these
snapshots through test helpers and must never read or write `studio/data/episodes`
or other live production state.

When product contracts intentionally change, create or review the fixture update
as part of the same change set and rerun the isolated full-suite check with the
live data directories absent.

Review tests resolve asset existence and integrity through the strict in-memory
table in `episode-fixture.mjs`. Tests that must exercise the production public
path boundary use only the tracked files under `studio/public/test-fixtures`.
Markdown importer tests use the tracked script snapshot under `episodes/` and
must not read the repository's mutable production episode directory.
