## [5.0.1](https://github.com/newrelic/video-caf-js/compare/v5.0.0...v5.0.1) (2026-10-30)

### Improvements

- **`@newrelic/video-core` updated to 5.1.1** and pinned to this exact version (previously `^5.1.0`), so every build uses the same core release.
- **Dependency pinning:** `dependencies` and `devDependencies` are now pinned to the exact versions already resolved in `package-lock.json`, so a fresh install no longer picks up newly published releases of build tooling.

# CHANGELOG

## [5.0.0](https://github.com/newrelic/video-caf-js/compare/v4.0.0...v5.0.0) (2026-09-24)

### New features

- **`/browser` subpath export:** A `@newrelic/video-caf/browser` entry point is
  now available that excludes the unused connected-device pipeline from the
  bundled `@newrelic/video-core` dependency, keeping the bundle lean. A
  `browser.js` filesystem shim is also included for bundlers that don't honor
  the `exports` field.
- **Named export:** `{ CAFTracker }` is now available as a named export alongside
  the existing default export on both the root and `/browser` entry points.

### Improvements

- **`@newrelic/video-core` updated to 5.1.0**, which includes TypeScript
  declaration files, upstream bug fixes, and dependency patches.


## [3.1.0] - Experimental - 2025/06/23
### Update
- Updated the version of Video Core.

## [3.0.0] - 2025/06/11
### Add
- New Event Type Introduced [VideoAction, VideoErrorAction, VideoAdAction, VideoCustomAction]
- New Attributes Added
- Harvester Logic Added

## [0.4.0] - 2021/02/04
### Add
- Seeking events.

## [0.3.0] - 2020/10/20
### Fix
- Duration and playhead time units.
 
### Update
- Dependencies.

## [0.2.0] - 2020/10/08
### Add
- Attribute `senderUserAgent`.

### Update
- Core dependencies.

## [0.1.0] - 2020/05/15
- First Version
