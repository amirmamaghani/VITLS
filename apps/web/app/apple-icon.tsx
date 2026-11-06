import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Home-screen icon: the same ink square and V as icon.svg, rendered to PNG. */
export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        background: "#202124",
      }}
    >
      <svg viewBox="0 0 64 64" width="180" height="180">
        <path d="M15 17h9.5L32 38.5 39.5 17H49L37 48h-10z" fill="#fff" />
      </svg>
    </div>,
    size,
  );
}
