#!/usr/bin/env node
// Publishes background images to the media CDN the way Astro used to build them: WebP at 1280, 1920, 2560 and
// 3840 px wide (never wider than the original), a 240 × 150 thumbnail for /credits, and the original itself so the
// set can be remade. Every file goes up through upload_media.sh under a content-hashed path, and the entry in
// src/data/backgrounds.json whose id is the file's name gets the paths.
//
//   aws-vault exec medic -- node script/publish_images.mjs ~/Pictures/orion.webp
import { execFileSync } from "node:child_process"
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, dirname, extname, join } from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

const WIDTHS = [1280, 1920, 2560, 3840]
const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const staging = join(root, "media/images")
const dataPath = join(root, "src/data/backgrounds.json")

if (process.argv.length < 3) {
  console.error("usage: node script/publish_images.mjs IMAGE...  (each named after its id in backgrounds.json)")
  process.exit(64)
}

mkdirSync(staging, { recursive: true })
const backgrounds = JSON.parse(readFileSync(dataPath, "utf8"))

for (const input of process.argv.slice(2)) {
  const id = basename(input, extname(input))
  const entry = backgrounds.find((background) => background.id === id)
  if (!entry) throw new Error(`${input}: backgrounds.json has no entry with the id ${id}`)

  const { width } = await sharp(input).metadata()
  const sizes = [...new Set([...WIDTHS.filter((w) => w < width), Math.min(width, WIDTHS.at(-1))])]
  const widths = []
  for (const size of sizes) {
    const file = join(staging, `${id}-${size}.webp`)
    await sharp(input).resize({ width: size }).webp({ quality: 80 }).toFile(file)
    widths.push({ file, width: size })
  }
  const thumb = join(staging, `${id}-thumb.webp`)
  await sharp(input).resize({ width: 240, height: 150, fit: "cover" }).webp({ quality: 75 }).toFile(thumb)
  const original = join(staging, `${id}.original${extname(input)}`)
  copyFileSync(input, original)

  const printed = execFileSync(join(root, "script/upload_media.sh"), ["images", ...widths.map(({ file }) => file), thumb, original], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  })
  const pathOf = Object.fromEntries(printed.trim().split("\n").map((line) => {
    const [file, url] = line.split("\t")
    return [file, new URL(url).pathname.slice(1)]
  }))
  entry.image = {
    widths: widths.map(({ file, width: size }) => ({ width: size, path: pathOf[file] })),
    thumb: pathOf[thumb],
    original: pathOf[original],
  }
  console.error(`published ${id}: ${sizes.join(", ")} px, a thumbnail and the original`)
}

writeFileSync(dataPath, `${JSON.stringify(backgrounds, null, 2)}\n`)
