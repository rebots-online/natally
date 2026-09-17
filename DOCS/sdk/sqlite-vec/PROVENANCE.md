# sqlite-vec native integration

Retrieved 2026-09-13 from the publisher's Rust integration guide:
https://alexgarcia.xyz/sqlite-vec/rust.html (local snapshot `rust.html`).
Native crate version is pinned to 0.1.9, matching the JavaScript storage dependency.
The crate compiles its included C source and registers it statically through
`sqlite3_auto_extension`; no runtime extension path is accepted from the client.
