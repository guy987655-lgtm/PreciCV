import { useMemo } from "react";
import QRCode from "qrcode";

/**
 * A QR code as one inline SVG path — vector, so the printed PDF stays sharp at
 * any zoom, and synchronous, so the CV renders (and measures for its one-page
 * fit) in a single pass with no image to wait for.
 *
 * No quiet zone of its own: callers sit it on a light tile, which doubles as
 * the margin scanners need and keeps it readable on the dark CV theme.
 */
export function QrCode({
  value,
  size,
  color = "#111111",
}: {
  value: string;
  /** Rendered edge length in CSS px. */
  size: number;
  color?: string;
}) {
  const qr = useMemo(() => {
    try {
      const { modules } = QRCode.create(value, { errorCorrectionLevel: "M" });
      let d = "";
      // One rect per horizontal run of dark modules, not per module: a third
      // of the path data for a typical URL.
      for (let row = 0; row < modules.size; row++) {
        let col = 0;
        while (col < modules.size) {
          if (!modules.get(row, col)) {
            col++;
            continue;
          }
          const start = col;
          while (col < modules.size && modules.get(row, col)) col++;
          d += `M${start} ${row}h${col - start}v1h-${col - start}z`;
        }
      }
      return { d, n: modules.size };
    } catch {
      // Too long to encode — callers cap the URL, but never break the CV.
      return null;
    }
  }, [value]);

  if (!qr) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${qr.n} ${qr.n}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="QR code"
      className="block"
    >
      <path d={qr.d} fill={color} />
    </svg>
  );
}
