import { defineCollection } from "astro:content"
import { z } from "astro/zod"
import { file } from "astro/loaders"
import { VIDEO_EFFECTS } from "./scripts/video-warp"

// A background is an image or a looping video. Video paths are relative to the media origin (see media.ts).
// The trip overlay always runs. overlay "calm" gives a video a breathing oversaturation; "psychedelic" (the default
// for images) gives it the slow hue drift; "hue-cycle" spins it round the colour wheel every 12 s. effects narrows
// the warp effects a video draws from each time it shows (all five without it).
const backgrounds = defineCollection({
  loader: file("src/data/backgrounds.json"),
  schema: z.object({
    position: z.number().int().positive(),
    title: z.string(),
    // What it shows; a mood can keep to some subjects (see scripts/mood.ts).
    subject: z.enum(["space", "wildlife", "landscape", "sea", "fire"]),
    author: z.string(),
    licence: z.string(),
    licenceUrl: z.url().optional(),
    sourceUrl: z.url(),
    // Paths on the media CDN, made by script/publish_images.mjs: WebP widths for srcset, a /credits thumbnail and
    // the original the set was made from.
    image: z.object({
      widths: z.array(z.object({ width: z.number().int().positive(), path: z.string() })).nonempty(),
      thumb: z.string(),
      original: z.string(),
    }).optional(),
    video: z.object({ av1: z.string().endsWith(".av1.mp4"), h264: z.string().endsWith(".h264.mp4") }).optional(),
    overlay: z.enum(["calm", "psychedelic", "hue-cycle"]).optional(),
    effects: z.array(z.enum(VIDEO_EFFECTS)).nonempty().optional(),
    // How hard a video's footage is bent: 1 is the full warp, lower leaves it truer (a landscape), higher bends more.
    distortion: z.number().min(0).max(2).optional(),
  }).refine((entry) => (entry.image === undefined) !== (entry.video === undefined), "needs exactly one of image and video"),
})

const music = defineCollection({
  loader: file("src/data/music.json"),
  schema: z.object({
    position: z.number().int().positive(),
    // The rendered file's name in media/music, and its content-hashed path on the media CDN once uploaded.
    file: z.string().endsWith(".mp3"),
    path: z.string().regex(/^music\/.+\.mp3$/),
    title: z.string(),
    composer: z.string(),
    work: z.string(),
    arrangement: z.string(),
    edition: z.string(),
    editionUrl: z.url(),
    // A MIDI file (.mid), a zip holding one, or a recording; member names the file kept in sources/.
    source: z.url(),
    member: z.string(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    slowdown: z.number().positive().max(1),
    firstBar: z.number().int().positive().optional(),
    lastBar: z.number().int().positive().optional(),
  }),
})

export const collections = { backgrounds, music }
