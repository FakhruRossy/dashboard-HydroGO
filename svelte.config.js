import adapter from '@sveltejs/adapter-vercel'; // <-- IMPORT INI
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter() // <-- GUNAKAN INI
  },
  preprocess: vitePreprocess()
};

export default config;