import { timingSafeEqual } from "node:crypto";

export function isAuthorizedCronRequest(
  header: string | null,
  secret: string | undefined
): boolean {
  if (!secret || !header?.startsWith("Bearer ")) return false;

  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(secret);

  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
