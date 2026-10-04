# Fragment landing page

Responsive HTML, CSS, and vanilla JavaScript. No framework, build step, account, analytics, or external runtime requests.

## Preview

From this directory:

```sh
python3 -m http.server 4178 --bind 127.0.0.1
```

Open `http://127.0.0.1:4178/`. Serve over HTTP for the SVG icon sprite. The downloadable package includes the same directory structure.

## What's included

- Responsive image-led hero with Fragment's existing logo and sample-library artwork.
- Three-view product tour using screenshots captured from the current desktop frontend running in browser demo mode.
- Filterable reference gallery, image dialogs, keyboard navigation, native FAQ disclosures, and extension setup instructions.
- Light and dark themes that initially follow the system preference; the footer toggle changes the current page.
- Reduced-motion handling and self-hosted, compressed image/font assets.
- Working local app and extension download links.

## Downloads

The preview includes copies of the existing local beta artifacts. Their repository-root paths are:

```text
target/release/artifacts/v0.0.8/Fragment_0.0.8_aarch64.dmg
target/release/artifacts/v0.0.8/Fragment-Extension-v0.0.8.zip
target/release/artifacts/v0.0.8/SHA256SUMS
```

The binaries are ignored in the app checkout. To recreate the downloads there, copy those three files into `downloads/` after building or obtaining the matching artifacts. The website branch and ZIP deliverable include them.

The app is an Apple silicon, ad-hoc-signed beta. Hosting the download does not install or notarize it. The website serves the beta artifacts directly using relative download paths. Before hosting a future version, replace the artifacts, update checksums, and update the download filenames and file size in `index.html`.

## GitHub Pages

Public URL: [blackridder22.github.io/Fragment](https://blackridder22.github.io/Fragment/).

The `codex/landing-page` branch of `blackridder22/Fragment` contains this website at its root, including both beta downloads. GitHub Pages publishes directly from that branch's `/` directory. `.nojekyll` keeps the HTML and assets unchanged. The app's development branches are independent of this website branch.

To update the site, clone the repository with `--single-branch --branch codex/landing-page`, replace the website files with the reviewed contents of `apps/landing/` (excluding `qa/`), and commit and push to the same branch. If updating beta files, explicitly stage them with `git add -f downloads/*.dmg downloads/*.zip`, and update `downloads/SHA256SUMS`. Preserve `.nojekyll`. Check the Pages deployment and live download checksums after pushing.

## Copy and design

Audience: designers and visual thinkers who save useful references across tabs, folders, and sites.

Money Strategy's Value Equation informed the copy: start with a usable visual collection, demonstrate the actual interface, explain the capture-to-Frame workflow, and reduce setup uncertainty with a direct beta download and concise instructions. No pricing, testimonials, adoption figures, or unmeasured speed claims were invented.

[Eagle](https://en.eagle.cool/) informed the collect / organize / rediscover story. The copy, layout, and assets are Fragment's own. The requested [Taste Skill](https://github.com/Leonxlnx/taste-skill) was installed only in a temporary folder and applied with `DESIGN_VARIANCE: 7`, `MOTION_INTENSITY: 4`, and `VISUAL_DENSITY: 3`.

Design: native CSS; asymmetric gallery layout; Manrope; off-white and forest-green semantic tokens. Buttons use pill radii, image tiles use 10px radii, and large surfaces use 24px radii. Page theme is consistent; dark product screenshots depict the app in either page theme.

## Verification

The local Lighthouse mobile audit after asset optimization scored:

| Category       | Score |
| -------------- | ----- |
| Performance    | 99    |
| Accessibility  | 100   |
| Best practices | 100   |
| SEO            | 100   |

Simulated mobile results: FCP 0.9s; LCP 2.0s; total blocking time 0ms; CLS 0. These are local lab measurements, not production analytics.

Browser checks covered desktop and mobile layouts, both themes, tab clicks and arrow-key navigation, gallery filtering, image previews, Escape/focus restoration, FAQ expansion, mobile navigation, download/setup dialogs, and browser error logs. Both beta file links returned HTTP 200 and matched the source SHA-256 checksums. JavaScript syntax and local asset/anchor references were checked.

Screenshots show sample content. This landing-page work does not verify the installed macOS app or live Chrome-to-native capture.

## Assets and licenses

- Product logo and reference artwork: existing Fragment repository assets.
- Product screenshots: current frontend with sample data, captured for this page.
- Manrope: [Fontsource](https://fontsource.org/fonts/manrope), SIL Open Font License, included in `assets/fonts/OFL.txt`.
- Tabler Icons: [Tabler](https://github.com/tabler/tabler-icons), MIT license, included in `assets/icons/LICENSE`. The original paths are combined in `assets/icons.svg`.

All images are optimized WebP copies. Original repository assets remain unchanged.
