/** Search key for food names: lowercase, no diacritics, punctuation as spaces ("Tvaroh polotučný" → "tvaroh polotucny"). */
export const searchKey = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}%]+/gu, " ")
    .trim();
