import type { MetadataRoute } from "next";
import { APP_DESCRIPTION } from "@/lib/app-info";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "fipa",
    short_name: "fipa",
    description: APP_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    background_color: "#FFF8EC",
    theme_color: "#FCCB78",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
