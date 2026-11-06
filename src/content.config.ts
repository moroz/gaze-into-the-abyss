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
    sourceZip: z.url().optional(),
    midi: z.url().optional(),
    member: z.string(),
    slowdown: z.number().positive().max(1),
    firstBar: z.number().int().positive().optional(),
    lastBar: z.number().int().positive().optional(),
  }).refine((track) => Boolean(track.sourceZip) !== Boolean(track.midi), "Give either sourceZip or midi"),
})

export const collections = { cosmos, music }
