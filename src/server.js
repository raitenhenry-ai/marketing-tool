import express from "express";
import path from "node:path";
import config from "./config.js";
import authRoutes from "./routes/auth.js";
import apiRoutes from "./routes/api.js";
import { startScheduler } from "./scheduler.js";

const app = express();
app.use(express.json());

app.use(express.static(path.join(config.rootDir, "public")));
// Clips must be publicly served: Instagram ingests them by URL.
app.use("/clips", express.static(config.clipsDir));

app.use("/auth", authRoutes);
app.use("/api", apiRoutes);

app.listen(config.port, () => {
  console.log(`Short-form manager running at ${config.baseUrl} (port ${config.port})`);
  if (!config.fontPath) {
    console.warn("[warn] No TTF font found - overlays will use ffmpeg's default font. Set FONT_PATH.");
  }
  startScheduler();
});
