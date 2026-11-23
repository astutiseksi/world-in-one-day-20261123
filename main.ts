// Solmar Bay is not this entry. This program draws "THE WORLD IN ONE DAY",
// a newspaper front page summing up the world's news of Monday 23 November
// 2026, as a single 1024x1024 PNG written to /output/entry.png
// (or $MAKEFUN_OUTPUT_DIR/entry.png).
//
// No network, no dependencies, no clock, no randomness: the same input
// always produces the same bytes. Node 22 standard library only.

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

// ---------------------------------------------------------------- canvas

const W = 1024;
const H = 1024;

const PAPER = [247, 242, 231];
const INK = [20, 20, 20];
const GREY = [110, 105, 95];
const RED = [163, 22, 33];
const BLUE = [29, 78, 137];
const TEAL = [14, 110, 105];
const GOLD = [176, 124, 22];
const GREEN = [46, 110, 58];
const SKY = [214, 231, 240];
const SAND = [232, 214, 178];
const DARK = [38, 38, 44];

type RGB = [number, number, number];

const px = new Uint8Array(W * H * 3);

function paint(c: RGB): void {
  for (let i = 0; i < W * H; i++) {
    px[i * 3] = c[0];
    px[i * 3 + 1] = c[1];
    px[i * 3 + 2] = c[2];
  }
}

function set(x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = c[0];
  px[i + 1] = c[1];
  px[i + 2] = c[2];
}

function rect(x: number, y: number, w: number, h: number, c: RGB): void {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(W, x + w);
  const y1 = Math.min(H, y + h);
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) set(xx, yy, c);
  }
}

function frame(x: number, y: number, w: number, h: number, c: RGB, t = 1): void {
  rect(x, y, w, t, c);
  rect(x, y + h - t, w, t, c);
  rect(x, y, t, h, c);
  rect(x + w - t, y, t, h, c);
}

function hline(x: number, y: number, w: number, c: RGB, t = 1): void {
  rect(x, y, w, t, c);
}

function disc(cx: number, cy: number, r: number, c: RGB): void {
  for (let yy = cy - r; yy <= cy + r; yy++) {
    for (let xx = cx - r; xx <= cx + r; xx++) {
      const dx = xx - cx;
      const dy = yy - cy;
      if (dx * dx + dy * dy <= r * r) set(xx, yy, c);
    }
  }
}

// Filled triangle by scanline interpolation.
function tri(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: RGB): void {
  const minY = Math.max(0, Math.min(y0, y1, y2));
  const maxY = Math.min(H - 1, Math.max(y0, y1, y2));
  for (let y = minY; y <= maxY; y++) {
    const xs: number[] = [];
    const edges: [number, number, number, number][] = [
      [x0, y0, x1, y1],
      [x1, y1, x2, y2],
      [x2, y2, x0, y0],
    ];
    for (const [ax, ay, bx, by] of edges) {
      if ((ay <= y && by > y) || (by <= y && ay > y)) {
        xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
      }
    }
    if (xs.length >= 2) {
      const lo = Math.max(0, Math.ceil(Math.min(...xs)));
      const hi = Math.min(W - 1, Math.floor(Math.max(...xs)));
      for (let x = lo; x <= hi; x++) set(x, y, c);
    }
  }
}

// Bresenham line.
function line(x0: number, y0: number, x1: number, y1: number, c: RGB, t = 1): void {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    rect(x - Math.floor(t / 2), y - Math.floor(t / 2), t, t, c);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

// ---------------------------------------------------------------- PNG out

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}

function encodePNG(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0;
    raw.set(px.subarray(y * W * 3, (y + 1) * W * 3), y * (1 + W * 3) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- 5x7 font
//
// Each glyph is seven rows of five bits, most significant bit leftmost.
// Lowercase folds to capitals: the whole page is set in capitals, in the
// manner of a newspaper front page.

const FONT: Record<string, number[]> = {
  A: [14, 17, 17, 31, 17, 17, 17],
  B: [30, 17, 17, 30, 17, 17, 30],
  C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15],
  H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14],
  J: [7, 2, 2, 2, 2, 18, 12],
  K: [17, 18, 20, 24, 20, 18, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 25, 21, 19, 17, 17, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13],
  R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30],
  T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 21, 21, 21, 10],
  X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4],
  Z: [31, 1, 2, 4, 8, 16, 31],
  "0": [14, 17, 19, 21, 25, 17, 14],
  "1": [4, 12, 4, 4, 4, 4, 14],
  "2": [14, 17, 1, 6, 8, 16, 31],
  "3": [31, 2, 4, 2, 1, 17, 14],
  "4": [2, 6, 10, 18, 31, 2, 2],
  "5": [31, 16, 30, 1, 1, 17, 14],
  "6": [14, 16, 16, 30, 17, 17, 14],
  "7": [31, 1, 2, 4, 8, 8, 8],
  "8": [14, 17, 17, 14, 17, 17, 14],
  "9": [14, 17, 17, 15, 1, 1, 14],
  " ": [0, 0, 0, 0, 0, 0, 0],
  ".": [0, 0, 0, 0, 0, 12, 12],
  ",": [0, 0, 0, 0, 12, 4, 8],
  ":": [0, 12, 12, 0, 12, 12, 0],
  ";": [0, 12, 12, 0, 12, 4, 8],
  "!": [4, 4, 4, 4, 4, 0, 4],
  "?": [14, 17, 1, 2, 4, 0, 4],
  "'": [4, 4, 8, 0, 0, 0, 0],
  '"': [10, 10, 10, 0, 0, 0, 0],
  "-": [0, 0, 0, 31, 0, 0, 0],
  "\u2013": [0, 0, 0, 31, 0, 0, 0],
  "\u2014": [0, 0, 0, 31, 0, 0, 0],
  "(": [2, 4, 8, 8, 8, 4, 2],
  ")": [8, 4, 2, 2, 2, 4, 8],
  "/": [1, 1, 2, 4, 8, 16, 16],
  "&": [12, 18, 20, 8, 21, 18, 13],
  "%": [25, 25, 2, 4, 8, 19, 19],
  $: [4, 15, 20, 14, 5, 30, 4],
  "#": [10, 10, 31, 10, 31, 10, 10],
  "*": [4, 21, 14, 21, 4, 0, 0],
  "+": [0, 4, 4, 31, 4, 4, 0],
  "=": [0, 0, 31, 0, 31, 0, 0],
  "<": [2, 4, 8, 16, 8, 4, 2],
  ">": [8, 4, 2, 1, 2, 4, 8],
  "@": [14, 17, 23, 21, 23, 16, 14],
  _: [0, 0, 0, 0, 0, 0, 31],
  "[": [14, 8, 8, 8, 8, 8, 14],
  "]": [14, 2, 2, 2, 2, 2, 14],
  "\u2022": [0, 4, 14, 14, 14, 4, 0],
  "\u2018": [4, 4, 8, 0, 0, 0, 0],
  "\u2019": [4, 4, 8, 0, 0, 0, 0],
};

const GLYPH_W = 5;
const GLYPH_H = 7;

function glyphOf(ch: string): number[] {
  const up = ch.toUpperCase();
  return FONT[up] ?? FONT["?"];
}

function textWidth(text: string, scale: number): number {
  return text.length * (GLYPH_W + 1) * scale - scale;
}

function drawText(text: string, x: number, y: number, scale: number, c: RGB): void {
  let cx = x;
  for (const ch of text) {
    const g = glyphOf(ch);
    for (let r = 0; r < GLYPH_H; r++) {
      const row = g[r];
      for (let col = 0; col < GLYPH_W; col++) {
        if (row & (1 << (GLYPH_W - 1 - col))) {
          rect(cx + col * scale, y + r * scale, scale, scale, c);
        }
      }
    }
    cx += (GLYPH_W + 1) * scale;
  }
}

function drawCentred(text: string, y: number, scale: number, c: RGB, x0 = 0, x1 = W): void {
  const w = textWidth(text, scale);
  drawText(text, x0 + Math.floor((x1 - x0 - w) / 2), y, scale, c);
}

// Greedy word wrap: returns lines that fit maxChars characters.
function wrap(text: string, maxChars: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur === "") {
      cur = w;
    } else if (cur.length + 1 + w.length <= maxChars) {
      cur += " " + w;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur !== "") lines.push(cur);
  return lines;
}

function drawWrapped(text: string, x: number, y: number, scale: number, c: RGB, maxChars: number, maxLines: number, leading: number): number {
  const lines = wrap(text, maxChars).slice(0, maxLines);
  lines.forEach((ln, i) => drawText(ln, x, y + i * leading, scale, c));
  return lines.length;
}

// ---------------------------------------------------------------- scenes
//
// Small flat illustrations, one per story, drawn into a sky band.
// Each takes the band's top-left corner and its width/height.

function sceneDhaka(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, [233, 220, 196]);
  // courthouse: pediment + columns + steps
  const bw = Math.floor(w * 0.52);
  const bx = x + Math.floor((w - bw) / 2);
  const by = y + Math.floor(h * 0.22);
  tri(bx - 8, by, bx + bw + 8, by, bx + Math.floor(bw / 2), by - 18, [120, 40, 44]);
  rect(bx, by, bw, Math.floor(h * 0.52), [248, 244, 232]);
  for (let i = 0; i < 4; i++) {
    const cx0 = bx + 8 + i * Math.floor((bw - 16) / 3);
    rect(cx0, by + 6, 7, Math.floor(h * 0.52) - 12, [176, 124, 22]);
  }
  rect(bx - 6, by + Math.floor(h * 0.52), bw + 12, 6, [120, 40, 44]);
  // flag of Bangladesh: green field, red disc, on a pole at the side
  const fx = x + 14;
  const fy = y + 10;
  line(fx, fy, fx, fy + Math.floor(h * 0.62), INK, 2);
  rect(fx + 2, fy, 34, 22, [0, 106, 78]);
  disc(fx + 18, fy + 11, 7, [244, 42, 65]);
  // crowd dots at the base
  for (let i = 0; i < 9; i++) disc(x + w - 18 - i * 9, y + h - 12, 3, INK);
}

function sceneSeoul(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, [255, 255, 255]);
  // South Korean flag: white field, taegeuk disc centre, trigrams corners.
  const cx = x + Math.floor(w * 0.5);
  const cy = y + Math.floor(h * 0.46);
  const r = 24;
  for (let yy = cy - r; yy <= cy + r; yy++) {
    for (let xx = cx - r; xx <= cx + r; xx++) {
      const dx = xx - cx;
      const dy = yy - cy;
      if (dx * dx + dy * dy <= r * r) {
        // S-curve split: boundary dips down on the left, up on the right.
        const edge = dy < (dx < 0 ? 6 : -6) ? [205, 49, 57] : [0, 56, 147];
        set(xx, yy, edge as RGB);
      }
    }
  }
  // small counter-discs that make the S
  disc(cx - 12, cy + 6, 6, [205, 49, 57]);
  disc(cx + 12, cy - 6, 6, [0, 56, 147]);
  // trigrams: three bars each; broken bars split in two
  const trigram = (tx: number, ty: number, broken: boolean[]): void => {
    for (let i = 0; i < 3; i++) {
      const by = ty + i * 6;
      if (broken[i]) {
        rect(tx, by, 8, 3, INK);
        rect(tx + 11, by, 8, 3, INK);
      } else {
        rect(tx, by, 19, 3, INK);
      }
    }
  };
  trigram(x + 14, y + 8, [false, false, false]);
  trigram(x + w - 33, y + 8, [true, false, true]);
  trigram(x + 14, y + h - 26, [false, true, false]);
  trigram(x + w - 33, y + h - 26, [true, true, true]);
}

function sceneCopenhagen(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, [240, 228, 216]);
  // crown
  const cx = x + Math.floor(w * 0.5);
  const cy = y + Math.floor(h * 0.42);
  tri(cx - 34, cy + 6, cx - 34, cy - 14, cx - 17, cy + 6, GOLD);
  tri(cx - 17, cy + 6, cx - 17, cy - 22, cx, cy + 6, GOLD);
  tri(cx, cy + 6, cx, cy - 22, cx + 17, cy + 6, GOLD);
  tri(cx + 17, cy + 6, cx + 17, cy - 14, cx + 34, cy + 6, GOLD);
  rect(cx - 36, cy + 6, 72, 8, GOLD);
  disc(cx - 34, cy - 16, 3, RED);
  disc(cx - 17, cy - 24, 3, RED);
  disc(cx, cy - 24, 3, RED);
  disc(cx + 17, cy - 24, 3, RED);
  disc(cx + 34, cy - 16, 3, RED);
  // target / crosshair beneath: the plot
  disc(cx, y + h - 22, 12, [255, 255, 255]);
  frame(cx - 12, y + h - 34, 25, 25, RED, 2);
  line(cx - 18, y + h - 22, cx + 18, y + h - 22, RED, 2);
  line(cx, y + h - 40, cx, y + h - 4, RED, 2);
}

function sceneDymer(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, [52, 52, 58]);
  // night sky + broken apartment block
  disc(x + w - 30, y + 16, 9, [240, 230, 190]);
  const bx = x + Math.floor(w * 0.2);
  const bw = Math.floor(w * 0.6);
  const by = y + Math.floor(h * 0.3);
  rect(bx, by + 18, bw, Math.floor(h * 0.7) - 18, [120, 116, 108]);
  tri(bx, by + 18, bx + 18, by, bx + 36, by + 18, [120, 116, 108]);
  tri(bx + 36, by + 18, bx + 58, by - 6, bx + 78, by + 18, [120, 116, 108]);
  // lit windows, some dark
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 5; c++) {
      const wx = bx + 8 + c * 16;
      const wy = by + 26 + r * 16;
      rect(wx, wy, 9, 10, (r + c) % 3 === 0 ? [40, 40, 44] : [240, 200, 90]);
    }
  }
  // smoke + flame at the break
  disc(bx + 46, by - 8, 8, [200, 200, 200]);
  disc(bx + 58, by - 18, 11, [220, 220, 220]);
  tri(bx + 40, by + 18, bx + 48, by - 2, bx + 56, by + 18, [230, 120, 30]);
  tri(bx + 44, by + 18, bx + 48, by + 6, bx + 52, by + 18, [240, 200, 60]);
}

function sceneAtlanta(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, SKY);
  // clouds
  disc(x + 26, y + 16, 10, [255, 255, 255]);
  disc(x + 40, y + 12, 12, [255, 255, 255]);
  disc(x + w - 40, y + 22, 11, [255, 255, 255]);
  disc(x + w - 26, y + 18, 8, [255, 255, 255]);
  // aeroplane, nose right, banking slightly
  const cx = x + Math.floor(w * 0.5);
  const cy = y + Math.floor(h * 0.5);
  tri(cx - 52, cy - 2, cx + 52, cy - 6, cx + 58, cy + 2, [40, 60, 90]);
  tri(cx + 52, cy + 2, cx + 58, cy + 2, cx + 44, cy + 10, [40, 60, 90]);
  tri(cx - 8, cy - 4, cx + 6, cy - 30, cx + 14, cy - 4, [40, 60, 90]);
  tri(cx - 2, cy + 4, cx + 8, cy + 26, cx + 16, cy + 4, [40, 60, 90]);
  tri(cx - 52, cy - 2, cx - 62, cy - 14, cx - 56, cy + 2, [40, 60, 90]);
  for (let i = 0; i < 4; i++) rect(cx - 30 + i * 12, cy - 3, 5, 4, [255, 255, 255]);
  // runway dashes below
  for (let i = 0; i < 8; i++) rect(x + 10 + i * 26, y + h - 10, 16, 3, [120, 120, 120]);
}

function sceneRamallah(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, [238, 226, 205]);
  // stone wall, courses of blocks
  const wy = y + Math.floor(h * 0.34);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 7; c++) {
      const bx = x + 8 + c * 30 + (r % 2) * 12;
      rect(bx, wy + r * 14, 26, 12, r % 2 ? [190, 175, 150] : [205, 190, 165]);
    }
  }
  // flame licking over the wall
  const fx = x + Math.floor(w * 0.5);
  tri(fx - 14, wy, fx, wy - 26, fx + 14, wy, [230, 120, 30]);
  tri(fx - 7, wy, fx, wy - 14, fx + 7, wy, [240, 200, 60]);
  // sprayed slogan marks: three red slashes on the wall
  line(x + 16, wy + 40, x + 30, wy + 26, RED, 3);
  line(x + 34, wy + 40, x + 48, wy + 26, RED, 3);
  line(x + w - 48, wy + 40, x + w - 34, wy + 26, RED, 3);
  // olive branch at the base
  line(x + 12, y + h - 12, x + 44, y + h - 22, GREEN, 2);
  for (let i = 0; i < 4; i++) disc(x + 16 + i * 8, y + h - 14 - i * 2, 3, GREEN);
}

// ---------------------------------------------------------------- stories

type Story = {
  kicker: string;
  headline: string;
  body: string;
  band: RGB;
  bandText: RGB;
  scene: (x: number, y: number, w: number, h: number) => void;
};

const STORIES: Story[] = [
  {
    kicker: "BANGLADESH — DHAKA",
    headline: "JAIL IF SHE RETURNS",
    body: "Dhaka vows to arrest ex-PM Sheikh Hasina the moment she sets foot home from India, and wants her extradited to face a death sentence.",
    band: RED,
    bandText: PAPER,
    scene: sceneDhaka,
  },
  {
    kicker: "SOUTH KOREA — SEOUL",
    headline: "FIRST WOMAN SPY CHIEF",
    body: "President Lee reshuffles his cabinet, naming ex-justice minister Kang Kum-sil to lead the spy agency — the country's first woman spy chief.",
    band: BLUE,
    bandText: PAPER,
    scene: sceneSeoul,
  },
  {
    kicker: "DENMARK — COPENHAGEN",
    headline: "ENVOY EXPELLED OVER RAPPER PLOT",
    body: "Denmark expels Russia's defence attache over a plot to kill Ukrainian-American rapper Kyivstoner, allegedly using a Danish gang.",
    band: GOLD,
    bandText: INK,
    scene: sceneCopenhagen,
  },
  {
    kicker: "UKRAINE — KYIV REGION",
    headline: "ELEVEN KILLED IN DYMER",
    body: "A Russian strike kills at least 11 in Dymer and a drone hits a kindergarten in Kharkiv as Moscow's overnight assaults grind on.",
    band: DARK,
    bandText: PAPER,
    scene: sceneDymer,
  },
  {
    kicker: "UNITED STATES — ATLANTA",
    headline: "1,600 FLIGHTS DELAYED",
    body: "A Delta weight-and-balance outage delays more than 1,600 flights from Atlanta as Thanksgiving travel begins, stranding crowds.",
    band: TEAL,
    bandText: PAPER,
    scene: sceneAtlanta,
  },
  {
    kicker: "WEST BANK — RAMALLAH",
    headline: "\u2018JEWISH TERRORISM\u2019",
    body: "Israel's PM-elect Gadi Eisenkot calls settler arson attacks on Palestinian villages 'Jewish terrorism' in unusually blunt terms.",
    band: GREEN,
    bandText: PAPER,
    scene: sceneRamallah,
  },
];

const TICKER =
  "ALSO TODAY \u2022 COP31 ends in collapse after the longest climate talks ever \u2022 Iran war: Bahrain site hit as Trump seeks a \u2018real deal\u2019 \u2022 Trump signs the Common Cents Act, ending the penny \u2022 Oregon and Virginia sue SpaceX";

const SOURCES =
  "SOURCES: REUTERS, JUST SECURITY, OPEN CHRONICLE, AP — ALL REPORTED 23 NOV 2026";

// ---------------------------------------------------------------- page

function drawMasthead(): void {
  drawCentred("MONDAY, 23 NOVEMBER 2026 \u2022 THE WORLD IN ONE IMAGE", 30, 2, GREY);
  drawCentred("THE WORLD IN ONE DAY", 54, 7, INK);
  hline(28, 108, W - 56, INK, 3);
  hline(28, 114, W - 56, INK, 1);
  drawCentred("SIX STORIES THAT DEFINED MONDAY", 124, 2, RED);
}

function drawPanel(s: Story, x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, PAPER);
  frame(x, y, w, h, INK, 2);
  // kicker band
  rect(x + 2, y + 2, w - 4, 24, s.band);
  drawText(s.kicker, x + 14, y + 9, 2, s.bandText);
  // headline, up to two lines
  const hy = y + 36;
  drawWrapped(s.headline, x + 12, hy, 3, INK, 25, 2, 22);
  // illustration
  const sy = y + 36 + 48;
  frame(x + 12, sy, w - 24, 72, INK, 1);
  s.scene(x + 13, sy + 1, w - 26, 70);
  // body, up to four lines
  const by = sy + 72 + 10;
  drawWrapped(s.body, x + 12, by, 2, INK, 37, 4, 17);
}

function drawTicker(): void {
  const y = 928;
  rect(28, y, W - 56, 60, INK);
  drawWrapped(TICKER, 40, y + 8, 2, PAPER, 78, 3, 17);
}

function drawFooter(): void {
  drawCentred(SOURCES, 996, 2, GREY);
}

function main(): void {
  paint(PAPER);
  drawMasthead();
  const px0 = 28;
  const pw = Math.floor((W - 56 - 16) / 2);
  const ph = 248;
  const py = [146, 408, 670];
  for (let i = 0; i < 6; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    drawPanel(STORIES[i], px0 + col * (pw + 16), py[row], pw, ph);
  }
  drawTicker();
  drawFooter();

  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "entry.png");
  const png = encodePNG();
  fs.writeFileSync(outFile, png);
  console.log(`wrote ${outFile} (${png.length} bytes, ${W}x${H})`);
}

main();
