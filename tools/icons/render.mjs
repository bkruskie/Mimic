#!/usr/bin/env node
/** Renders apps/companion/public/icon.svg to the PNG sizes the web manifest and iOS need. Run after editing the SVG. */
import { readFileSync } from "node:fs";
import sharp from "sharp";

const dir = "apps/companion/public";
const svg = readFileSync(`${dir}/icon.svg`);
await sharp(svg, { density: 384 }).resize(192, 192).png().toFile(`${dir}/icon-192.png`);
await sharp(svg, { density: 384 }).resize(512, 512).png().toFile(`${dir}/icon-512.png`);
await sharp(svg, { density: 384 }).resize(180, 180).png().toFile(`${dir}/apple-touch-icon.png`);
// Maskable: the art inside the central 80% safe zone, on the hollow colour.
const inner = await sharp(svg, { density: 384 }).resize(400, 400).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: "#241A26" } })
  .composite([{ input: inner, top: 56, left: 56 }])
  .png()
  .toFile(`${dir}/icon-maskable-512.png`);
console.log("Icons written to", dir);
