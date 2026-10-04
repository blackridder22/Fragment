import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";

// Original deterministic test artwork, distributed under this repository's MIT license.
const root = resolve(process.argv[2] ?? "fixtures/media");
mkdirSync(root, { recursive: true });
const manifest = [];
function save(name, bytes, expected) {
  const data = Buffer.from(bytes);
  writeFileSync(join(root, name), data);
  manifest.push({
    name,
    sha256: createHash("sha256").update(data).digest("hex"),
    bytes: data.length,
    expected,
  });
}
function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++)
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const body = Buffer.concat([Buffer.from(type), bytes]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc(body));
  return Buffer.concat([length, body, checksum]);
}
function png(width, height, pixel) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const pixels = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      pixels.set(pixel(x, y), y * (width * 4 + 1) + 1 + x * 4);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const svg = (body, size = 'width="640" height="320"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${size}>${body}</svg>`;
const red = png(640, 320, () => [255, 0, 0, 255]);
save("solid-red.png", red, "one #FF0000 swatch, coverage 1");
save(
  "two-color.png",
  png(640, 320, (x) => (x < 160 ? [0, 255, 0, 255] : [0, 0, 255, 255])),
  "green 25%, blue 75%, within 2 percentage points",
);
save(
  "transparent.png",
  png(320, 320, () => [255, 0, 255, 0]),
  "empty palette",
);
save(
  "transparent-logo.png",
  png(640, 320, (x, y) =>
    x > 160 && x < 480 && y > 80 && y < 240
      ? [255, 128, 0, 128]
      : [255, 0, 255, 0],
  ),
  "orange only; transparent magenta excluded",
);
save(
  "grayscale.png",
  png(640, 320, (x) => {
    const v = Math.floor((x / 640) * 256);
    return [v, v, v, 255];
  }),
  "all swatches neutral",
);
save(
  "gradient.png",
  png(640, 320, (x, y) => [
    Math.floor((x / 640) * 256),
    Math.floor((y / 320) * 256),
    128,
    255,
  ]),
  "deterministic varied palette",
);
save(
  "two-color.svg",
  svg(
    '<path fill="#00ff00" d="M0 0h160v320H0z"/><path fill="#0000ff" d="M160 0h480v320H160z"/>',
  ),
  "green 25%, blue 75%; 2:1 transparent PNGs",
);
save(
  "transparent-logo.svg",
  svg('<circle fill="#ff8000" fill-opacity="0.5" cx="320" cy="160" r="90"/>'),
  "straight alpha orange; no black halo",
);
save(
  "gradient-mask.svg",
  svg(
    '<defs><linearGradient id="g"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient><mask id="m"><circle fill="white" cx="320" cy="160" r="150"/></mask></defs><rect width="640" height="320" fill="url(#g)" mask="url(#m)"/>',
  ),
  "gradient in circular mask",
);
save(
  "filter-clip.svg",
  svg(
    '<defs><filter id="b"><feGaussianBlur stdDeviation="4"/></filter><clipPath id="c"><rect x="30" y="30" width="400" height="200"/></clipPath></defs><g clip-path="url(#c)"><circle cx="300" cy="160" r="140" fill="#40b0ff" filter="url(#b)"/></g>',
  ),
  "blur and clipping",
);
save(
  "text.svg",
  svg(
    '<text x="20" y="120" font-family="Arial" font-size="64">Fragment</text>',
  ),
  "installed font text",
);
save(
  "missing-font.svg",
  svg(
    '<text x="20" y="120" font-family="FragmentMissingFontFixture" font-size="64">Fragment</text>',
  ),
  "font_substitution warning",
);
save(
  "embedded.svg",
  svg(
    `<image width="640" height="320" href="data:image/png;base64,${red.toString("base64")}"/>`,
  ),
  "red embedded PNG",
);
save(
  "huge-viewport.svg",
  svg(
    '<rect width="1000000" height="1000000" fill="red"/>',
    'width="1000000" height="1000000"',
  ),
  "bounded 640/1600 square derivatives",
);
save(
  "external.svg",
  svg(
    '<image width="640" height="320" href="file:///tmp/fragment-private-probe.png"/>',
  ),
  "unsupported_svg; no file read",
);
save(
  "network.svg",
  svg(
    '<image width="640" height="320" href="https://example.invalid/private.png"/>',
  ),
  "unsupported_svg; no request",
);
save("script.svg", svg("<script>alert(1)</script>"), "unsupported_svg");
save(
  "animated.svg",
  svg(
    '<rect width="10" height="10"><animate attributeName="x" values="0;100" dur="1s"/></rect>',
  ),
  "unsupported_svg",
);
save(
  "foreign-object.svg",
  svg(
    '<foreignObject width="100" height="100"><div>HTML</div></foreignObject>',
  ),
  "unsupported_svg",
);
save(
  "entities.svg",
  '<!DOCTYPE svg [<!ENTITY x "private">]><svg xmlns="http://www.w3.org/2000/svg"><text>&x;</text></svg>',
  "unsupported_svg",
);
save("malformed.svg", "<svg><g></svg>", "invalid_svg");
save("html.svg", "<html><body>Not an image</body></html>", "invalid_svg");
save(
  "nested-limit.svg",
  svg("<g>".repeat(129) + "<path/>" + "</g>".repeat(129)),
  "unsupported_svg",
);
writeFileSync(
  join(root, "manifest.json"),
  JSON.stringify(
    {
      provenance:
        "Procedural artwork: repository MIT license. NASA photograph: NASA Johnson Space Center, AS17-148-22727; see README.md. No user assets.",
      fixtures: [
        ...manifest,
        {
          name: "nasa-blue-marble.jpg",
          sha256: createHash("sha256")
            .update(readFileSync(join(root, "nasa-blue-marble.jpg")))
            .digest("hex"),
          bytes: readFileSync(join(root, "nasa-blue-marble.jpg")).length,
          expected:
            "photographic coverage; deterministic palette of at most six colors",
          source:
            "https://www.nasa.gov/image-article/blue-marble-view-from-apollo-17/",
        },
      ],
    },
    null,
    2,
  ) + "\n",
);
console.log(`Generated ${manifest.length} fixtures in ${root}`);
