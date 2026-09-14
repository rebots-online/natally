# Vendored ephemeris source

This directory belongs to natally. Its contents are ordinary tracked files, not
submodules or nested Git repositories. No upstream remotes or automatic updates
are configured. Customize this source and commit changes in natally.

- [`sweph-wasm/`](sweph-wasm/) contains the complete wrapper repository at version
  2.6.9, including TypeScript sources, build tooling, and the matching published
  `dist/` runtime (JavaScript, WASM, declarations, maps, and ephemeris tables).
- [`sweph-wasm/swisseph/`](sweph-wasm/swisseph/) contains the complete Astrodienst
  Swiss Ephemeris repository at the exact revision referenced by that wrapper.
- [`sweph-wasm.UPSTREAM-VENDOR.lock.json`](sweph-wasm.UPSTREAM-VENDOR.lock.json)
  records origins, revisions, dates, licenses, and assimilation details.
- [`ephemeris-manifest.json`](ephemeris-manifest.json) records the original
  imported file hashes and archive integrity. Subsequent local customizations
  are preserved by natally's Git history, not reset to this baseline.

`packages/ephemeris` depends on `file:../../VENDORED/sweph-wasm`. Package
installation therefore consumes this local runtime rather than fetching a copy
of sweph-wasm from npm. After changing the wrapper or C source, rebuild the local
WASM and JavaScript outputs before installing/building the app. The wrapper's
build tool reads its adjacent `swisseph/` source. Its legacy `--download` switch
now only checks local source availability; it cannot overwrite changes from an
upstream branch.

Binary runtime/data assets use Git LFS on the project's Forgejo endpoint. GitHub
receives pointers only; `.lfsconfig` supplies the Forgejo download endpoint for
fresh clones. Source, licensing, and provenance remain ordinary Git content.

`scripts/vendor-ephemeris.py` materializes a missing initial snapshot and verifies
the published npm archive integrity. If a local snapshot already exists it leaves
it untouched. Original upstream archives are preserved under
`~/outbox/natally/upstream-archives/` on the importing host.
The initial import applies the committed `patches/sweph-wasm-2.6.9-detach.patch`
so source-only build preparation and Forgejo LFS rules survive re-materialization.
These changes follow Admin-Manual INC-15's provenance-and-assimilation procedure.
