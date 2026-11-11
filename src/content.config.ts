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
        title: z.string(),
    }),
});

const footer = defineCollection({
    loader: glob({ pattern: "**/*.md", base: "./src/content/footer" }),
    schema: z.object({}),
});

const footnote = defineCollection({
    loader: file("./src/content/footer/footnote.json"),
    schema: z.object({
        left: z.string(),
        right: z.string(),
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
        venue_image: z.string().optional(),
        start_datetime: z.string().nullable().optional(),
        end_datetime: z.string().nullable().optional(),
    }),
});

const menu = defineCollection({
    loader: file("./src/content/menu/menu.json"),
    schema: z.object({
        title: z.string(),
        // Display order of the category on the page. The file() loader does
        // not guarantee array order out of getCollection, so sort on this.
        order: z.number(),
        items: z.array(
            z.object({
                name: z.string(),
                description: z.string().optional(),
                // Optional accompaniments shown as a "Choice of" list
                sides: z.array(z.string()).optional(),
                // Label above the sides list; defaults to "Choice of"
                sides_label: z.string().optional(),
                // Filename under public/images/menu/
                photo: z.string().optional(),
                credit: z
                    .object({
                        author: z.string(),
                        license: z.string(),
                        source: z.string(),
                    })
                    .optional(),
            }),
        ),
    }),
});

const site = defineCollection({
    loader: file("./src/content/site/site.json"),
    schema: z.object({
        site_url: z.string(),
        groom_name: z.string(),
        bride_name: z.string(),
        tagline: z.string(),
        hero_pre: z.string(),
        tamil_names: z.string(),
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
        footer_close_delay_seconds: z.number().optional(),
        umami_base_url: z.string().optional(),
        umami_website_id: z.string().optional(),
    }),
});

export const collections = { couple, story, footer, footnote, event, menu, site };