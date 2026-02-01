import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

export default defineConfig(({mode}) => {
  // We need https to test the mic on mobile during development
  // But we don't want https in preview because
  //  we want to test the service worker installing correctly
  const useHttps = mode === "development";
  return {
    plugins: [
      react(),
      tailwindcss(),
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
