// Benchmark (untested end to end, see handover/video-render.md): fast-forward to SKIP seconds, then capture SECONDS of 3840x2160 at 60 fps into x264, timing each stage.
import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import puppeteer from "puppeteer-core"

const [url, out, flagSet = "vulkan"] = process.argv.slice(2)
const FPS = 60
const SKIP = Number(process.env.SKIP ?? 60)
const SECONDS = Number(process.env.SECONDS_ ?? 10)
const WIDTH = Number(process.env.WIDTH ?? 3840)
const HEIGHT = Number(process.env.HEIGHT ?? 2160)
const FLAGS = {
  vulkan: ["--use-angle=vulkan", "--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan"],
  gl: ["--use-angle=gl"],
  egl: ["--use-gl=angle", "--use-angle=gl-egl"],
}

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? "/usr/bin/google-chrome",
  headless: true,
  args: ["--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required", "--hide-scrollbars", ...FLAGS[flagSet]],
})
const page = await browser.newPage()
page.on("console", (message) => { if (message.type() === "error") console.error("page:", message.text()) })
await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 })
await page.evaluateOnNewDocument(readFileSync(new URL("clock.js", import.meta.url), "utf8"))
await page.evaluateOnNewDocument(() => {
  addEventListener("DOMContentLoaded", () => {
    const style = document.createElement("style")
    style.textContent = ".music, .hint, .fullscreen-toggle, .source-link { display: none !important; } * { cursor: none !important; }"
    document.head.append(style)
  })
})
const renderer = await page.evaluate(() => {
  const gl = document.createElement("canvas").getContext("webgl2")
  const info = gl?.getExtension("WEBGL_debug_renderer_info")
  return gl ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "no WebGL 2"
})
console.log(`renderer (${flagSet}): ${renderer}`)
await page.goto(url, { waitUntil: "load" })

const cdp = await page.createCDPSession()
const step = () => page.evaluate((ms) => window.__clock.step(ms), 1000 / FPS)

let t = performance.now()
for (let frame = 0; frame < SKIP * FPS; frame++) await step()
const skipMs = performance.now() - t
console.log(`fast-forward ${SKIP}s: ${(skipMs / 1000).toFixed(1)} s real, ${(skipMs / (SKIP * FPS)).toFixed(1)} ms/step`)

const ffmpeg = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "png", "-i", "-",
  "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-pix_fmt", "yuv420p", "-colorspace", "bt709", "-color_primaries", "bt709",
  "-color_trc", "bt709", out], { stdio: ["pipe", "inherit", "inherit"] })
const write = (buffer) => new Promise((resolve) => (ffmpeg.stdin.write(buffer) ? resolve() : ffmpeg.stdin.once("drain", resolve)))

const totals = { step: 0, seek: 0, capture: 0, write: 0, seeks: 0 }
const onScreen = new Set()
t = performance.now()
for (let frame = 0; frame < SECONDS * FPS; frame++) {
  let mark = performance.now()
  const { seekMs, seeks } = await step()
  totals.step += performance.now() - mark - seekMs
  totals.seek += seekMs
  totals.seeks += seeks
  mark = performance.now()
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true })
  totals.capture += performance.now() - mark
  mark = performance.now()
  await write(Buffer.from(data, "base64"))
  totals.write += performance.now() - mark
  if (frame % 120 === 0) onScreen.add(await page.evaluate(() => document.querySelector(".slide.is-active")?.dataset.credit ?? "none"))
}
ffmpeg.stdin.end()
const captureMs = performance.now() - t
await new Promise((resolve) => ffmpeg.on("close", resolve))
const encodeTail = performance.now() - t - captureMs
const frames = SECONDS * FPS
console.log(`captured ${frames} frames in ${(captureMs / 1000).toFixed(1)} s: ${(frames / (captureMs / 1000)).toFixed(2)} fps`)
for (const key of ["step", "seek", "capture", "write"]) console.log(`  ${key}: ${(totals[key] / frames).toFixed(1)} ms/frame`)
console.log(`  seeks: ${totals.seeks}; encoder finished ${(encodeTail / 1000).toFixed(1)} s after the last frame`)
console.log("on screen:", [...onScreen].map((credit) => JSON.parse(credit).title ?? credit).join(" | "))
await browser.close()
