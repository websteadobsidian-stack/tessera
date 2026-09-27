import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { api } from "../lib/api";

let configPromise: Promise<{ public_url: string | null; demo: boolean; version: string }> | null = null;

export function publicConfig() {
  configPromise ??= api<{ public_url: string | null; demo: boolean; version: string }>("/api/config")
    .catch(() => ({ public_url: null, demo: false, version: "?" }));
  return configPromise;
}

/** Адрес, по которому участники заходят с телефонов: PUBLIC_URL сервера или текущий адрес. */
export function useJoinUrl(code: string | null | undefined) {
  const [base, setBase] = useState<string>(window.location.origin);
  useEffect(() => {
    void publicConfig().then((c) => { if (c.public_url) setBase(c.public_url.replace(/\/$/, "")); });
  }, []);
  return code ? `${base}/join/${code}` : base;
}

export function QrCode({ text, size = 220, dark = "#0b0b10", light = "#ffffff" }: { text: string; size?: number; dark?: string; light?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(text, { margin: 1, width: size * 2, errorCorrectionLevel: "M", color: { dark, light } })
      .then((url) => { if (alive) setSrc(url); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [text, size, dark, light]);
  return (
    <span className="qr" style={{ width: size, height: size }}>
      {src && <img src={src} width={size} height={size} alt={`QR-код: ${text}`} />}
    </span>
  );
}
