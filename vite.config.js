import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import {cloudflare} from "@cloudflare/vite-plugin";
import {VitePWA} from "vite-plugin-pwa";

const APP_DISPLAY_NAME = "Voicebox";

export default defineConfig(({mode}) => {
  const buildTimeIso = new Date().toISOString();
  // We need https to test the mic on mobile during development
  // But we don't want https in preview because
  //  we want to test the service worker installing correctly
  const useHttps = mode === "development";
  return {
    define: {
      __BUILD_TIME_ISO__: JSON.stringify(buildTimeIso),
    },
    plugins: [
      react(),
      tailwindcss(),
      cloudflare(),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["icon-voice.svg"],
        manifest: {
          id: "/",
          name: APP_DISPLAY_NAME,
          short_name: APP_DISPLAY_NAME,
          description: "Voice pitch visualizer for tuning and vibrato practice.",
          start_url: "/",
          display: "standalone",
          orientation: "portrait",
          theme_color: "#000",
          background_color: "#000",
          icons: [
            {
              src: "/icon-voice.svg",
              sizes: "any",
              type: "image/svg+xml",
              purpose: "any maskable",
            },
          ],
        },
        workbox: {
          navigateFallback: "/index.html",
        },
      }),
      ...(useHttps ? [basicSsl()] : []),
    ],
    server: {
      port: 8089,
      host: true,
      https: useHttps,
    },
    preview: {
      port: 8090,
      host: true,
    },
  };
});
