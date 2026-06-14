import { defineCollection, z } from "astro:content";
import { glob, file } from "astro/loaders";

const couple = defineCollection({
    loader: glob({ pattern: "**/*.md", base: "./src/content/couple" }),
    schema: z.object({
        name: z.string(),
        role: z.string(),
        bio: z.string(),
        photo: z.string().optional(),
    }),
});

const story = defineCollection({
    loader: glob({ pattern: "**/*.md", base: "./src/content/story" }),
    schema: z.object({
        period: z.string(),
        title: z.string(),
        photo: z.string().optional(),
    }),
});

const event = defineCollection({
    loader: file("./src/content/event/event.json"),
    schema: z.object({
        date: z.string(),
        time: z.string(),
        venue: z.string(),
        address: z.string(),
        maps_url: z.string().optional(),
        dress: z.string(),
    }),
});

const site = defineCollection({
    loader: file("./src/content/site/site.json"),
    schema: z.object({
        groom_name: z.string(),
        bride_name: z.string(),
        tagline: z.string(),
        hero_pre: z.string(),
        tamil_names: z.string(),
        tamil_thanks: z.string(),
        footer_note: z.string(),
        upload_url: z.string().optional(),
        rsvp_webhook_url: z.string().optional(),
        upload_parent_dir: z.string().optional(),
        immich_base_url: z.string().optional(),
        immich_share_slug: z.string().optional(),
        camera_max_shots: z.number().optional(),
        album_available_after: z.string().optional(),
        album_notify_webhook_url: z.string().optional(),
        camera_max_uploads: z.number().optional(),
        story_images: z.number().optional(),
    }),
});

export const collections = { couple, story, event, site };