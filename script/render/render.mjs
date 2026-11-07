#!/usr/bin/env node
// Renders the site as a video, frame-exact: a headless Chrome runs the built site (dist/) in #render mode on a clock
// that moves exactly one frame per step; the stage converts each frame to yuv420p on the GPU and posts it here, and
// ffmpeg encodes it. See the README's "Rendering a video" section.
//
//   node script/render/render.mjs <out-dir> [--minutes 30] [--seed abyss] [--size 3840x2160] [--fps 60]
//   node script/render/render.mjs <out-dir> --clip --start 20 --seconds 10     # one short clip, with timings
//
// The full render goes in one-minute segments (<out-dir>/segments/), so a crash resumes where it stopped; the last
// fades to black, and the segments are joined into <out-dir>/abyss_<seed>_<minutes>m.mp4.

import { execFileSync, spawn } from "node:child_process"
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { homedir } from "node:os"
import { extname, join, normalize, resolve } from "node:path"
import { parseArgs } from "node:util"
import puppeteer from "puppeteer-core"

const ROOT = resolve(import.meta.dirname, "../..")
const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    minutes: { type: "string", default: "30" },
    seed: { type: "string", default: "abyss" },
    size: { type: "string", default: "3840x2160" },
    fps: { type: "string", default: "60" },
    clip: { type: "boolean", default: false },
    start: { type: "string", default: "0" },
    seconds: { type: "string", default: "10" },
    fade: { type: "string", default: "5" },
    encoder: { type: "string", default: process.env.ENCODER ?? "hevc_nvenc" },
    quality: { type: "string", default: "19" },
    "any-gpu": { type: "boolean", default: false },
  },
})
const OUT = resolve(positionals[0] ?? "render-out")
const FPS = Number(options.fps)
const [WIDTH, HEIGHT] = options.size.split("x").map(Number)
const SEGMENT_SECONDS = 60
const FRAMES = join(ROOT, "media/render-frames")
const DIST = join(ROOT, "dist")
const CHROME = process.env.CHROME ?? "/usr/bin/google-chrome"
// Homebrew's ffmpeg has no NVENC; Debian's does (unpacked without root under ~/.local/opt if it is not installed).
const FFMPEG = process.env.FFMPEG ?? [join(homedir(), ".local/opt/ffmpeg-debian/root/usr/bin/ffmpeg"), "/usr/bin/ffmpeg"].find(existsSync) ?? "ffmpeg"
const FFPROBE = FFMPEG.replace(/ffmpeg$/, "ffprobe")
if (WIDTH % 8 || HEIGHT % 2) throw new Error("the width must be a multiple of 8 and the height even")
if (!existsSync(join(DIST, "index.html"))) throw new Error("no dist/: run pnpm build first")

const log = (...parts) => console.log(new Date().toISOString().slice(11, 19), ...parts)
const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`

// Every background video's frames, decoded once into JPEGs the page can fetch, with a manifest of their timing.
const extractFrames = () => {
  const backgrounds = JSON.parse(readFileSync(join(ROOT, "src/data/backgrounds.json"), "utf8"))
  const origin = readFileSync(join(ROOT, "src/scripts/media.ts"), "utf8").match(/"(https:\/\/[^"]+)"/)[1]
  const manifestPath = join(FRAMES, "manifest.json")
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {}
  for (const { video } of backgrounds) {
    if (!video) continue
    const stem = video.h264.split("/").pop().replace(/\.mp4$/, "")
    if (manifest[stem]) continue
    const url = `${origin}/${video.h264}`
    const dir = join(FRAMES, stem)
    log(`extracting frames of ${stem}`)
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    execFileSync(FFMPEG, ["-v", "error", "-i", url, "-q:v", "2", "-start_number", "1", join(dir, "%05d.jpg")])
    const [width, height, rate] = execFileSync(FFPROBE, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate", "-of", "csv=p=0", url], { encoding: "utf8" }).trim().split(",")
    const [numerator, denominator] = rate.split("/").map(Number)
    manifest[stem] = { fps: numerator / denominator, frames: readdirSync(dir).length, width: Number(width), height: Number(height) }
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  }
}

// The encoder for one output file, fed raw yuv420p frames.
const encoder = (path, fadeOutAt) => {
  const quality = options.encoder.endsWith("nvenc")
    ? ["-preset", "p6", "-tune", "hq", "-rc", "vbr", "-cq", options.quality, "-b:v", "0", "-bf", "2", "-g", String(FPS * 2)]
    : ["-preset", "slow", "-crf", options.quality]
  const filters = fadeOutAt === undefined ? [] : ["-vf", `fade=t=out:st=${fadeOutAt}:d=${options.fade}`]
  const ffmpeg = spawn(FFMPEG, ["-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "yuv420p", "-color_range", "tv", "-s", `${WIDTH}x${HEIGHT}`, "-r", String(FPS), "-i", "-",
    ...filters, "-c:v", options.encoder, ...quality, "-pix_fmt", "yuv420p",
    "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
    ...(options.encoder.startsWith("hevc") ? ["-tag:v", "hvc1"] : []), "-movflags", "+faststart", "-f", "mp4", path], { stdio: ["pipe", "inherit", "inherit"] })
  const closed = new Promise((resolveClose, reject) => ffmpeg.on("close", (code) => (code === 0 ? resolveClose() : reject(new Error(`ffmpeg exited ${code} for ${path}`)))))
  // A segment abandoned after a crash ends its encoder early; that failure is expected, not fatal.
  closed.catch(() => {})
  return { stdin: ffmpeg.stdin, finish: () => { ffmpeg.stdin.end(); return closed } }
}

// Serves dist/ and the frames, and takes each rendered frame on POST /frame.
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".webp": "image/webp", ".jpg": "image/jpeg", ".png": "image/png", ".mp3": "audio/mpeg", ".woff2": "font/woff2", ".txt": "text/plain" }
let sink
// Anything that went wrong in the page or with a frame; the next step throws it, so a broken stage cannot go on
// encoding a frozen or shifted picture.
let failure
const server = createServer((request, response) => {
  if (request.method === "POST" && request.url === "/frame") {
    if (!sink) {
      response.writeHead(409).end()
      return
    }
    // Checked before a byte reaches ffmpeg: a frame of the wrong size would shift every frame after it.
    const expected = (WIDTH * HEIGHT * 3) / 2
    if (Number(request.headers["content-length"]) !== expected) {
      failure ??= new Error(`frame of ${request.headers["content-length"]} bytes, expected ${expected}`)
      request.resume()
      response.writeHead(400).end()
      return
    }
    const into = sink
    let bytes = 0
    request.on("data", (chunk) => {
      bytes += chunk.length
      if (!into.stdin.write(chunk)) {
        request.pause()
        into.stdin.once("drain", () => request.resume())
      }
    })
    request.on("end", () => {
      if (bytes !== expected) failure ??= new Error(`frame of ${bytes} bytes, expected ${expected}`)
      response.writeHead(bytes === expected ? 204 : 400).end()
    })
    return
  }
  const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname)
  const [base, relative] = path.startsWith("/render-frames/") ? [FRAMES, path.slice("/render-frames/".length)] : [DIST, path.slice(1)]
  let file = normalize(join(base, relative))
  if (!file.startsWith(base)) return response.writeHead(403).end()
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html")
  if (!existsSync(file)) return response.writeHead(404).end()
  response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" })
  createReadStream(file).pipe(response)
})

extractFrames()
await new Promise((ready) => server.listen(0, "127.0.0.1", ready))
const PORT = server.address().port
let frame = 0

let browser
let page
// Starts Chrome on the page, its clock at zero.
const open = async () => {
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    // On a laptop with two GPUs, PRIME render offload puts Chrome's GL on the NVIDIA card (ANGLE over EGL: headless
    // Chrome gets no WebGL 2 from Vulkan).
    env: { ...process.env, __NV_PRIME_RENDER_OFFLOAD: "1", __GLX_VENDOR_LIBRARY_NAME: "nvidia", __EGL_VENDOR_LIBRARY_FILENAMES: "/usr/share/glvnd/egl_vendor.d/10_nvidia.json" },
    // --expose-gc: each frame leaves a 12 MB Blob that Chrome frees only once it is collected, and left to itself it
    // runs out of blob memory within a minute of 4K; the renderer collects every GC_EVERY frames.
    args: ["--js-flags=--expose-gc", "--enable-gpu", "--ignore-gpu-blocklist", "--use-gl=angle", "--use-angle=gl-egl", "--hide-scrollbars", "--mute-audio",
      "--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
  })
  page = await browser.newPage()
  page.on("console", (message) => { if (["error", "warn"].includes(message.type())) console.error("page:", message.text()) })
  page.on("pageerror", (error) => {
    console.error("page error:", error.message)
    failure ??= error
  })
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 })
  await page.evaluateOnNewDocument(readFileSync(join(import.meta.dirname, "clock.js"), "utf8"))
  await page.goto(`http://127.0.0.1:${PORT}/#seed=${encodeURIComponent(options.seed)}&render=/render-frames`, { waitUntil: "load" })
  await page.waitForFunction(() => window.__abyss)
  const renderer = await page.evaluate(() => window.__abyss.renderer())
  log(`renderer: ${renderer}`)
  if (!/nvidia/i.test(renderer) && !options["any-gpu"]) throw new Error("not rendering on the NVIDIA GPU (pass --any-gpu to allow it)")
  page.on("error", (error) => {
    console.error("page crashed:", error.message)
    failure ??= error
  })
  failure = undefined
  frame = 0
}


const STEP_MS = 1000 / FPS
const GC_EVERY = 30
const step = (capture) => page.evaluate(async (ms, capture, collect) => {
  if (collect) globalThis.gc()
  const started = window.__clock.realNow()
  await window.__clock.step(ms)
  const stepped = window.__clock.realNow()
  const [read, post] = capture ? await window.__abyss.send("/frame") : [0, 0]
  return [stepped - started, read, post]
}, STEP_MS, capture, capture && frame % GC_EVERY === 0).then((timings) => {
  if (failure) throw failure
  return timings
}).finally(() => frame++)

const fastForward = async (seconds) => {
  if (seconds <= 0) return
  await page.evaluate(() => window.__abyss.capture(false))
  const started = performance.now()
  while (frame < Math.round(seconds * FPS)) await step(false)
  log(`fast-forwarded to ${clock(seconds)} in ${((performance.now() - started) / 1000).toFixed(0)} s`)
}

// Renders frames up to the end time into one file.
const renderTo = async (path, endSeconds, fadeOutAt) => {
  await page.evaluate(() => window.__abyss.capture(true))
  const part = `${path}.part`
  sink = encoder(part, fadeOutAt)
  const totals = [0, 0, 0]
  const first = frame
  const started = performance.now()
  let reported = started
  while (frame < Math.round(endSeconds * FPS)) {
    const timings = await step(true)
    timings.forEach((ms, i) => { totals[i] += ms })
    if (performance.now() - reported > 15_000) {
      reported = performance.now()
      const done = frame - first
      log(`  ${clock(frame / FPS)}  ${(done / ((reported - started) / 1000)).toFixed(1)} fps  step ${(totals[0] / done).toFixed(1)} ms  read ${(totals[1] / done).toFixed(1)} ms  upload wait ${(totals[2] / done).toFixed(1)} ms`)
    }
  }
  await page.evaluate(() => window.__abyss.flush())
  const encoderDone = sink.finish()
  sink = undefined
  await encoderDone
  renameSync(part, path)
  const done = frame - first
  const seconds = (performance.now() - started) / 1000
  return { frames: done, seconds, fps: done / seconds, stepMs: totals[0] / done, readMs: totals[1] / done, postMs: totals[2] / done }
}

await open()
mkdirSync(OUT, { recursive: true })
if (options.clip) {
  const start = Number(options.start)
  await fastForward(start)
  const path = join(OUT, `clip_${options.seed}_${start}s.mp4`)
  const result = await renderTo(path, start + Number(options.seconds))
  log(`${path}: ${result.frames} frames in ${result.seconds.toFixed(1)} s, ${result.fps.toFixed(1)} fps (step ${result.stepMs.toFixed(1)} ms, read ${result.readMs.toFixed(1)} ms, upload wait ${result.postMs.toFixed(1)} ms)`)
} else {
  const minutes = Number(options.minutes)
  const segments = join(OUT, "segments")
  mkdirSync(segments, { recursive: true })
  const name = (index) => join(segments, `segment-${String(index).padStart(3, "0")}.mp4`)
  const count = Math.ceil((minutes * 60) / SEGMENT_SECONDS)
  // Segments only resume into the run that made them: another seed, size, rate or length (the last segment's fade)
  // would not join up.
  const params = JSON.stringify({ seed: options.seed, size: options.size, fps: FPS, minutes, fade: options.fade, encoder: options.encoder, quality: options.quality })
  const paramsPath = join(segments, "params.json")
  const rendered = readdirSync(segments).some((file) => file.endsWith(".mp4"))
  if (existsSync(paramsPath) && readFileSync(paramsPath, "utf8") !== params) {
    throw new Error(`${segments} holds a render with other settings (${readFileSync(paramsPath, "utf8")}); use another <out-dir>`)
  }
  if (!existsSync(paramsPath)) {
    if (rendered) log(`no params.json beside the rendered segments; taking them as this run's`)
    writeFileSync(paramsPath, params)
  }
  // A crash (the GPU process lost to a suspend, say) relaunches Chrome and resumes at the first missing segment.
  const ATTEMPTS = 5
  for (let attempt = 1; ; attempt++) {
    try {
      if (attempt > 1) await open()
      const firstMissing = [...Array(count).keys()].find((index) => !existsSync(name(index))) ?? count
      if (firstMissing > 0) log(`${firstMissing} of ${count} segments already rendered`)
      // Resuming steps through the rendered part at the same 1/FPS steps, so the page is exactly where it was.
      await fastForward(firstMissing * SEGMENT_SECONDS)
      const started = performance.now()
      for (let index = firstMissing; index < count; index++) {
        const end = Math.min((index + 1) * SEGMENT_SECONDS, minutes * 60)
        const length = end - index * SEGMENT_SECONDS
        const fade = index === count - 1 ? Math.max(0, length - Number(options.fade)) : undefined
        const result = await renderTo(name(index), end, fade)
        const elapsed = (performance.now() - started) / 1000
        const remaining = (elapsed / (index - firstMissing + 1)) * (count - index - 1)
        log(`segment ${index + 1}/${count} done: ${result.fps.toFixed(1)} fps; about ${clock(remaining / 60)} h:min left`)
      }
      break
    } catch (error) {
      sink?.stdin.destroy()
      sink = undefined
      await browser.close().catch(() => {})
      if (attempt >= ATTEMPTS) throw error
      log(`attempt ${attempt} failed (${error.message.split("\n")[0]}); relaunching`)
    }
  }
  const list = join(OUT, "segments.txt")
  writeFileSync(list, [...Array(count).keys()].map((index) => `file '${name(index)}'`).join("\n") + "\n")
  const final = join(OUT, `abyss_${options.seed}_${minutes}m.mp4`)
  execFileSync(FFMPEG, ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", final])
  log(`done: ${final}`)
}

await browser.close()
server.close()
