import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import mdx from "@astrojs/mdx";
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  output: "static",
  adapter: cloudflare(),
  integrations: [mdx()],
  vite: {
    plugins: [basicSsl()],
    server: {
      https: true,
    },
  },
});
