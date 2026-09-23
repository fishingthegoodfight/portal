import EventShareImage from "./opengraph-image";

// Same card as opengraph-image.tsx. Needed as its own file: the site-wide
// app/twitter-image.png would otherwise win for twitter:image on this route
// (file-based metadata outranks generateMetadata and is inherited).
// Config exports are repeated as literals — they must be statically readable.
export const alt = "Fishing the Good Fight event";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default EventShareImage;
