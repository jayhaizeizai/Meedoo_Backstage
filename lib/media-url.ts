import { createHmac, timingSafeEqual } from "node:crypto";
import { getLarkConfig } from "./auth";

function mediaSecret() {
  const secret = process.env.MEDIA_URL_SECRET ?? process.env.SESSION_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("MEDIA_URL_SECRET_NOT_CONFIGURED");
  return secret;
}

function sign(value: string) {
  return createHmac("sha256", mediaSecret()).update(value).digest("base64url");
}

export function createMediaUrl(
  id: string,
  filename: string,
  ttlSeconds = 6 * 60 * 60,
) {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const signature = sign(`${id}.${expires}`);
  const safeFilename =
    filename.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-120) || "video.mp4";
  return `${getLarkConfig().appUrl}/api/media/${encodeURIComponent(id)}/${encodeURIComponent(safeFilename)}?expires=${expires}&signature=${encodeURIComponent(signature)}`;
}

export function verifyMediaUrl(
  id: string,
  expiresValue: string | null,
  signatureValue: string | null,
) {
  const expires = Number(expiresValue);
  if (
    !Number.isInteger(expires) ||
    expires < Math.floor(Date.now() / 1000) ||
    expires > Math.floor(Date.now() / 1000) + 24 * 60 * 60 ||
    !signatureValue
  )
    return false;
  const expected = Buffer.from(sign(`${id}.${expires}`));
  const supplied = Buffer.from(signatureValue);
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}
