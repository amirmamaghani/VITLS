import { assertFieldKeysConfigured } from "../db/encrypted";

/** Production boot check: refuse to start without a valid field-encryption key ring. */
export default (): void => {
  if (process.env.NODE_ENV === "production") assertFieldKeysConfigured();
};
