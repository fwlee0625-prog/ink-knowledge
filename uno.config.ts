import { defineConfig, presetWind } from "unocss";

export default defineConfig({
  presets: [presetWind()],
  shortcuts: {
    "action-button": "inline-flex items-center justify-center select-none transition-opacity duration-150",
    "stack-page": "min-h-screen",
  },
});
