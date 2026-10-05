# Automatic private Node.js runtime

Goal: remove manual Node.js installation from the Docker Russian user flow.

Design: keep the existing original-app launcher. Reuse a working Node.js 18+ from PATH; otherwise download the latest Node.js 24 LTS archive and its SHA-256 checksum over HTTPS from nodejs.org. Select an exact version from the checksum list, download that immutable version, verify before extraction or execution, and persist only the executable and license in a private user-owned runtime folder. Do not modify PATH or vendor Docker files. Refuse foreign folders, links and unsupported architectures. A repeat run reuses the verified local runtime.

Files: `install.sh`, its identical Linux entry point, `windows/install.ps1`, README, START-HERE, manifest and offline bootstrap tests. The controller continues using process.execPath so the generated shortcut targets the persistent executable.

- [x] Add offline tests for an empty PATH with no Node.js, checksum failure, cache reuse/tampering, links/foreign directories and an existing compatible Node.
- [x] Add the automatic runtime bootstrap for macOS/Linux and Windows.
- [x] Replace the manual runtime prerequisite with the two-command flow in documentation.
- [x] Check fixture behavior and syntax without launching Docker or installing a runtime in the user's home. Fourteen Node fixture tests and Bash/Node syntax passed; PowerShell is unavailable locally, so its runtime remains unverified. Review found and fixed native stderr handling for PowerShell 5.1.
- [x] Update package metadata to 3.0.1; retain the preliminary release policy and real-OS limitations.
