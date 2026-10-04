//! Deterministic, alpha-weighted dominant colors from the canonical thumbnail.
use image::{imageops::FilterType, DynamicImage};
use palette::{FromColor, Oklab, Srgb};
use serde::{Deserialize, Serialize};

pub const ALGORITHM_VERSION: i64 = 1;
const MAX_COLORS: usize = 6;
const MERGE_DISTANCE_SQUARED: f64 = 0.025 * 0.025;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PaletteColor {
    pub hex: String,
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub l: f64,
    pub a: f64,
    pub lab_b: f64,
    pub coverage: f64,
}

pub fn rgb_lab(r: u8, g: u8, b: u8) -> [f64; 3] {
    let lab = Oklab::from_color(
        Srgb::new(
            f64::from(r) / 255.0,
            f64::from(g) / 255.0,
            f64::from(b) / 255.0,
        )
        .into_linear(),
    );
    [lab.l, lab.a, lab.b]
}
pub fn distance(a: &[f64; 3], b: &[f64; 3]) -> f64 {
    (a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)
}

struct Point {
    lab: [f64; 3],
    weight: f64,
}
fn nearest(point: &[f64; 3], centers: &[[f64; 3]]) -> usize {
    (0..centers.len())
        .min_by(|a, b| {
            distance(point, &centers[*a])
                .total_cmp(&distance(point, &centers[*b]))
                .then(a.cmp(b))
        })
        .unwrap_or(0)
}

pub fn extract(thumbnail: &DynamicImage) -> Vec<PaletteColor> {
    // Nearest sampling avoids inventing colored borders around alpha-zero pixels.
    let sample = thumbnail.resize(256, 256, FilterType::Nearest).to_rgba8();
    let mut bins = vec![[0_f64; 4]; 32 * 32 * 32];
    for pixel in sample.pixels() {
        let [r, g, b, a] = pixel.0;
        if a == 0 {
            continue;
        }
        let weight = f64::from(a) / 255.0;
        let index = ((r as usize >> 3) << 10) | ((g as usize >> 3) << 5) | (b as usize >> 3);
        let bin = &mut bins[index];
        bin[0] += f64::from(r) * weight;
        bin[1] += f64::from(g) * weight;
        bin[2] += f64::from(b) * weight;
        bin[3] += weight;
    }
    let points: Vec<_> = bins
        .into_iter()
        .filter(|b| b[3] > 0.0)
        .map(|bin| {
            let lab = Oklab::from_color(
                Srgb::new(
                    bin[0] / bin[3] / 255.0,
                    bin[1] / bin[3] / 255.0,
                    bin[2] / bin[3] / 255.0,
                )
                .into_linear(),
            );
            Point {
                lab: [lab.l, lab.a, lab.b],
                weight: bin[3],
            }
        })
        .collect();
    if points.is_empty() {
        return vec![];
    }
    let first = (0..points.len())
        .max_by(|a, b| {
            points[*a]
                .weight
                .total_cmp(&points[*b].weight)
                .then(b.cmp(a))
        })
        .unwrap_or(0);
    let mut centers = vec![points[first].lab];
    while centers.len() < MAX_COLORS.min(points.len()) {
        let score = |p: &Point| distance(&p.lab, &centers[nearest(&p.lab, &centers)]) * p.weight;
        let index = (0..points.len())
            .max_by(|a, b| {
                score(&points[*a])
                    .total_cmp(&score(&points[*b]))
                    .then(b.cmp(a))
            })
            .unwrap_or(0);
        if score(&points[index]) <= f64::EPSILON {
            break;
        }
        centers.push(points[index].lab);
    }
    for _ in 0..12 {
        let mut sums = vec![[0_f64; 4]; centers.len()];
        for point in &points {
            let sum = &mut sums[nearest(&point.lab, &centers)];
            for (i, v) in point.lab.iter().enumerate() {
                sum[i] += v * point.weight;
            }
            sum[3] += point.weight;
        }
        let mut changed = false;
        for (center, sum) in centers.iter_mut().zip(sums) {
            if sum[3] == 0.0 {
                continue;
            }
            let next = [sum[0] / sum[3], sum[1] / sum[3], sum[2] / sum[3]];
            changed |= distance(center, &next) > 1e-12;
            *center = next;
        }
        if !changed {
            break;
        }
    }
    let mut merged = Vec::new();
    for center in centers {
        if !merged
            .iter()
            .any(|other| distance(&center, other) < MERGE_DISTANCE_SQUARED)
        {
            merged.push(center);
        }
    }
    let mut sums = vec![[0_f64; 4]; merged.len()];
    for point in &points {
        let sum = &mut sums[nearest(&point.lab, &merged)];
        for (i, v) in point.lab.iter().enumerate() {
            sum[i] += v * point.weight;
        }
        sum[3] += point.weight;
    }
    let total: f64 = points.iter().map(|p| p.weight).sum();
    let mut colors: Vec<_> = sums
        .into_iter()
        .filter(|s| s[3] > 0.0)
        .map(|s| {
            let rgb: Srgb<f64> =
                Srgb::from_color(Oklab::new(s[0] / s[3], s[1] / s[3], s[2] / s[3]));
            let byte = |v: f64| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
            let (r, g, b) = (byte(rgb.red), byte(rgb.green), byte(rgb.blue));
            let [l, a, lab_b] = rgb_lab(r, g, b);
            PaletteColor {
                hex: format!("#{r:02X}{g:02X}{b:02X}"),
                r,
                g,
                b,
                l: l.clamp(0.0, 1.0),
                a,
                lab_b,
                coverage: s[3] / total,
            }
        })
        .collect();
    colors.sort_by(|a, b| b.coverage.total_cmp(&a.coverage).then(a.hex.cmp(&b.hex)));
    colors
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};
    #[test]
    fn solids_transparency_coverage_and_determinism() {
        let solid =
            DynamicImage::ImageRgba8(RgbaImage::from_pixel(640, 640, Rgba([255, 0, 0, 255])));
        let colors = extract(&solid);
        assert_eq!(colors.len(), 1);
        assert_eq!(colors[0].hex, "#FF0000");
        assert_eq!(colors[0].coverage, 1.0);
        let two = DynamicImage::ImageRgba8(RgbaImage::from_fn(640, 640, |x, _| {
            if x < 160 {
                Rgba([0, 255, 0, 255])
            } else {
                Rgba([0, 0, 255, 255])
            }
        }));
        let colors = extract(&two);
        assert_eq!(colors.len(), 2);
        assert_eq!(colors[0].hex, "#0000FF");
        assert!((colors[0].coverage - 0.75).abs() < 0.02);
        assert_eq!(colors, extract(&two));
        let alpha = DynamicImage::ImageRgba8(RgbaImage::from_fn(256, 256, |x, _| {
            if x < 128 {
                Rgba([255, 0, 255, 0])
            } else {
                Rgba([128, 128, 128, 128])
            }
        }));
        let colors = extract(&alpha);
        assert_eq!(colors.len(), 1);
        assert_eq!(colors[0].hex, "#808080");
        assert!(extract(&DynamicImage::ImageRgba8(RgbaImage::new(20, 20))).is_empty());
    }
}
