const C1_CONTROL_CHARACTERS = /[\u0080-\u009f]/;
const HAN_CHARACTERS = /[\u3400-\u9fff\uf900-\ufaff]/;

/**
 * Busboy follows the multipart default and exposes raw UTF-8 filename bytes as
 * Latin-1 characters when a client sends only `filename=`. Recover those bytes
 * without touching filenames that are already valid Unicode.
 */
export function normalizeMultipartFilename(filename: string) {
  if (!filename || [...filename].some((character) => character.codePointAt(0)! > 0xff)) {
    return filename;
  }

  const decoded = Buffer.from(filename, "latin1").toString("utf8");
  if (decoded.includes("\uFFFD") || decoded === filename) return filename;

  const looksLikeUtf8Mojibake = C1_CONTROL_CHARACTERS.test(filename) || HAN_CHARACTERS.test(decoded);
  return looksLikeUtf8Mojibake ? decoded : filename;
}
