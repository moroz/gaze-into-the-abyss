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
  schema: ({ image }) => z.object({
    position: z.number().int().positive(),
    title: z.string(),
    author: z.string(),
    licence: z.string(),
    licenceUrl: z.url().optional(),
    sourceUrl: z.url(),
    image: image().optional(),
    video: z.object({ av1: z.string().endsWith(".av1.mp4"), h264: z.string().endsWith(".h264.mp4") }).optional(),
    overlay: z.enum(["calm", "psychedelic", "hue-cycle"]).optional(),
    effects: z.array(z.enum(VIDEO_EFFECTS)).nonempty().optional(),
  }).refine((entry) => (entry.image === undefined) !== (entry.video === undefined), "needs exactly one of image and video"),
})

const music = defineCollection({
  loader: file("src/data/music.json"),
  schema: z.object({
    position: z.number().int().positive(),
    file: z.string().endsWith(".mp3"),
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
