"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * The admin event page's "Share" block: the public page's URL (see
 * app/events/[slug]), a copy button, and a QR code of it — PNG, generated in
 * the browser, downloadable for flyers. The QR encodes the slug URL, which
 * never breaks: a later slug change keeps the old one redirecting.
 */
export function ShareEventCard({
  url,
  slug,
  published,
  cancelled,
}: {
  url: string;
  slug: string;
  published: boolean;
  cancelled: boolean;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let current = true;
    // 1024px with a quiet zone: sharp when printed, and "M" error correction
    // survives a crease or smudge on a flyer.
    QRCode.toDataURL(url, { width: 1024, margin: 2, errorCorrectionLevel: "M" })
      .then((dataUrl) => current && setQr(dataUrl))
      .catch(() => current && setQr(null));
    return () => {
      current = false;
    };
  }, [url]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (e.g. no secure context) — the URL is
      // right there to select by hand.
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Share</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Anyone can open this page — no account needed. It shows the date, place, and
            spots left, never the meeting link or who&apos;s registered.
          </p>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={url}
              aria-label="Public event link"
              onFocus={(e) => e.currentTarget.select()}
              className="h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 text-sm"
            />
            <Button type="button" variant="outline" size="sm" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={url} target="_blank" rel="noreferrer">
                Open public page
              </a>
            </Button>
            {qr && (
              <Button asChild variant="outline" size="sm">
                <a href={qr} download={`${slug}-qr.png`}>
                  Download QR code
                </a>
              </Button>
            )}
          </div>
          {!published && (
            <p className="text-sm text-amber-600">
              This event isn&apos;t published, so the link shows &quot;not found&quot; until it is.
            </p>
          )}
          {cancelled && (
            <p className="text-sm text-muted-foreground">
              The page shows the cancellation and its reason.
            </p>
          )}
        </div>
        {qr && (
          // eslint-disable-next-line @next/next/no-img-element -- a data: URL, nothing for next/image to optimize
          <img
            src={qr}
            alt={`QR code for ${url}`}
            width={144}
            height={144}
            className="h-36 w-36 shrink-0 rounded-md border bg-white p-1"
          />
        )}
      </CardContent>
    </Card>
  );
}
