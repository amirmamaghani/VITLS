/** The coach's latest morning readout (directive + highlights) in the native user-settings store, shown by the readout widget. */
import { getUserSetting, putUserSetting } from "@agent-native/core/settings";
import { z } from "zod";

const SETTING_KEY = "vitls-readout";

export const readoutSchema = z.object({
  date: z.iso.date(),
  directive: z.string().min(1).max(280),
  /** One line addressing the user by name, in their persona's voice; the dashboard heading. Optional for older readouts. */
  greeting: z.string().min(1).max(80).optional(),
  highlights: z.array(z.object({ metric: z.string().min(1).max(40), note: z.string().min(1).max(80) })).max(3),
});
export type Readout = z.infer<typeof readoutSchema>;

export async function saveReadout(userEmail: string, input: Readout): Promise<Readout> {
  const readout = readoutSchema.parse(input);
  await putUserSetting(userEmail, SETTING_KEY, readout);
  return readout;
}

export async function getReadout(userEmail: string): Promise<Readout | null> {
  const stored = await getUserSetting(userEmail, SETTING_KEY);
  const parsed = readoutSchema.safeParse(stored);
  return parsed.success ? parsed.data : null;
}
