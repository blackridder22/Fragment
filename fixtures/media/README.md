# Media correctness corpus

Procedural PNG/SVG artwork is original test material under this repository's MIT license. Regenerate it with `node scripts/generate-media-fixtures.mjs`; the checked-in photograph is preserved and its hash is included. `manifest.json` fixes bytes, SHA-256 and expected outcomes.

`nasa-blue-marble.jpg` is NASA Johnson Space Center photograph AS17-148-22727, taken by the Apollo 17 crew. Source: [NASA image article](https://www.nasa.gov/image-article/blue-marble-view-from-apollo-17/). Original download: [NASA JPEG](https://www.nasa.gov/wp-content/uploads/2023/03/as17-148-22727_lrg_0.jpg). NASA imagery is used under its [media usage guidance](https://www.nasa.gov/nasa-brand-center/images-and-media/); this credit implies no NASA endorsement. This file is separate from the procedural artwork's MIT license.

The 100,000-element, 5 MiB and repeated embedded-image stress cases are generated inside Rust tests so large redundant inputs are not committed. Correctness fixtures are not a promise of support for every SVG feature.
