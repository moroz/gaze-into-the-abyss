import { defineCollection } from "astro:content"
import { z } from "astro/zod"
import { file } from "astro/loaders"

const cosmos = defineCollection({
  loader: file("src/data/cosmos.json"),
  schema: ({ image }) => z.object({
    position: z.number().int().positive(),
    image: image(),
    title: z.string(),
    credit: z.string(),
    nasaId: z.string(),
  }),
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

export const collections = { cosmos, music }
