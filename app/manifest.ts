import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Distortion Tracker",
    short_name: "Distortion",
    description: "Real-time friend location tracker for techno music festivals.",
    start_url: "/",
    display: "standalone",
    background_color: "#131313",
    theme_color: "#c3f400",
    icons: [
      {
        src: "/icon-512.png",
        sizes: "1024x1024",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "1024x1024",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/apple-touch-icon.png",
        sizes: "1024x1024",
        type: "image/png",
      },
    ],
  };
}
