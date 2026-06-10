export function normalizeClaimKey(claimText: string): string {
  return claimText
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,!?;:]+$/g, '');
}
