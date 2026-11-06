import { Injectable } from "@nestjs/common";
import { SettingsService } from "../common/settings/settings.service";
import { coachProfileSchema, readoutSchema, type CoachProfile, type Readout } from "./coach.schema";

export type Localization = { locale?: string; timezone?: string };

@Injectable()
export class CoachService {
  constructor(private readonly settings: SettingsService) {}

  async getProfile(ownerEmail: string) {
    const profile = coachProfileSchema.parse((await this.settings.get(ownerEmail, "vitls-coach")) ?? {});
    // The Plan #3b cron reads readoutTime directly; no job resource to probe.
    return { profile, onboarded: profile.onboardingStage === "done", readoutScheduled: profile.readoutTime != null };
  }

  async updateProfile(ownerEmail: string, patch: CoachProfile): Promise<CoachProfile> {
    const changes = coachProfileSchema.parse(patch);
    const current = await this.settings.get<CoachProfile>(ownerEmail, "vitls-coach");
    const merged = { ...current, ...changes };
    await this.settings.put(ownerEmail, "vitls-coach", merged);
    return merged;
  }

  async getReadout(ownerEmail: string): Promise<Readout | null> {
    const parsed = readoutSchema.safeParse(await this.settings.get(ownerEmail, "vitls-readout"));
    return parsed.success ? parsed.data : null;
  }

  async saveReadout(ownerEmail: string, input: Readout): Promise<Readout> {
    const readout = readoutSchema.parse(input);
    await this.settings.put(ownerEmail, "vitls-readout", readout);
    return readout;
  }

  async getLocalization(ownerEmail: string): Promise<Localization> {
    return (await this.settings.get<Localization>(ownerEmail, "localization")) ?? {};
  }

  async setLocalization(ownerEmail: string, patch: Localization): Promise<Localization> {
    const merged = { ...(await this.getLocalization(ownerEmail)), ...patch };
    await this.settings.put(ownerEmail, "localization", merged);
    return merged;
  }
}
