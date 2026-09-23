import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { formatEventDateRange } from "@/lib/format-date";
import { loadPublicEvent, publicLocationSummary } from "@/lib/public-events";

// The large preview card shown when an event link is pasted into a text,
// Facebook, Instagram, etc. — also used for the Twitter card (see the
// page's generateMetadata). Same anon-only data as the page itself.
export const alt = "Fishing the Good Fight event";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Geist, the same face as ImageResponse's built-in default — which only
// ships a regular weight, so a bold title needs the files. Passing fonts
// replaces the default, hence Regular too. OFL — see assets/fonts/Geist-LICENSE.txt.
const [geistRegular, geistBold] = await Promise.all([
  readFile(join(process.cwd(), "assets/fonts/Geist-Regular.ttf")),
  readFile(join(process.cwd(), "assets/fonts/Geist-Bold.ttf")),
]);

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const lookup = await loadPublicEvent(slug);
  const event = lookup.kind === "found" ? lookup.event : null;
  const cancelled = event?.status === "cancelled";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "#14532d",
          color: "#ffffff",
          fontFamily: "Geist",
        }}
      >
        <div style={{ display: "flex", fontSize: 32, opacity: 0.85 }}>Fishing the Good Fight</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {cancelled && (
            <div
              style={{
                display: "flex",
                alignSelf: "flex-start",
                background: "#b91c1c",
                padding: "8px 20px",
                borderRadius: 8,
                fontSize: 32,
                fontWeight: 700,
              }}
            >
              CANCELLED
            </div>
          )}
          <div style={{ display: "flex", fontSize: 72, fontWeight: 700, lineHeight: 1.1 }}>
            {event?.name ?? "Event"}
          </div>
          {event && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 36 }}>
              <div style={{ display: "flex" }}>
                {formatEventDateRange(event.starts_at, event.ends_at, event.timezone)}
              </div>
              {publicLocationSummary(event) && (
                <div style={{ display: "flex", opacity: 0.85 }}>{publicLocationSummary(event)}</div>
              )}
            </div>
          )}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Geist", data: geistRegular, style: "normal", weight: 400 },
        { name: "Geist", data: geistBold, style: "normal", weight: 700 },
      ],
    },
  );
}
