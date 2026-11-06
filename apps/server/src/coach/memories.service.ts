import { Injectable } from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import { DbService } from "../common/db/db.service";
import { coachMemories } from "../db/schema";

export type MemoryType = "user" | "feedback" | "project" | "reference";

const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const tokenize = (s: string) => fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const STOP = new Set("the and for with that this have you your not are was but how who why what when can did does will about from out over than then my in a to is of on it i me do am an be or at as we he she they him her his its our us by so".split(" "));
// whole-token match; prefix only when the prefix side is >=4 chars ("squat"~"squats"), so short words can't match inside others
const matches = (t: string, h: string) => h === t || (t.length >= 4 && h.startsWith(t)) || (h.length >= 4 && t.startsWith(h));

@Injectable()
export class MemoriesService {
  constructor(private readonly dbs: DbService) {}

  async save(
    ownerEmail: string,
    m: { name: string; type: MemoryType; description: string; content: string },
  ): Promise<void> {
    const set = { type: m.type, description: m.description, content: m.content, updatedAt: new Date().toISOString() };
    await this.dbs.db
      .insert(coachMemories)
      .values({ ownerEmail, name: m.name, ...set })
      .onConflictDoUpdate({ target: [coachMemories.ownerEmail, coachMemories.name], set });
  }

  async list(ownerEmail: string) {
    return this.dbs.db
      .select({
        name: coachMemories.name,
        type: coachMemories.type,
        description: coachMemories.description,
        content: coachMemories.content,
        updatedAt: coachMemories.updatedAt,
      })
      .from(coachMemories)
      .where(eq(coachMemories.ownerEmail, ownerEmail))
      .orderBy(desc(coachMemories.updatedAt));
  }

  /** Top memories by distinct query tokens found in name+description; zero-score dropped. Never throws. */
  async selectRelevant(ownerEmail: string, query: string, limit = 2): Promise<{ name: string; description: string; content: string }[]> {
    try {
      const tokens = new Set(tokenize(query).filter((t) => t.length >= 3 && !STOP.has(t)));
      if (!tokens.size) return [];
      return (await this.list(ownerEmail)) // already updatedAt desc; stable sort keeps that as tie-break
        .map((m) => {
          const hay = [...new Set(tokenize(`${m.name} ${m.description}`))];
          return { m, score: [...tokens].filter((t) => hay.some((h) => matches(t, h))).length };
        })
        .filter((x) => x.score > 0)
        .sort((x, y) => y.score - x.score)
        .slice(0, limit)
        .map(({ m }) => ({ name: m.name, description: m.description, content: m.content }));
    } catch {
      return [];
    }
  }
}
