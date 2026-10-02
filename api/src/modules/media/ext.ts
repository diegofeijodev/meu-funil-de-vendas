/** Extensão de arquivo pelo tipo MIME (só os que os provedores devolvem). */
export const extFromMimeSafe = (mime: string | null | undefined): string => {
  const m = (mime ?? '').toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('webp')) return 'webp';
  if (m.includes('quicktime')) return 'mov';
  if (m.includes('mp4') || m.startsWith('video/')) return 'mp4';
  return 'bin';
};
