import { Injectable } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { DbService } from "../common/db/db.service";
import { chatThreads } from "../db/schema";

type UIMessage = import("ai", { with: { "resolution-mode": "import" } }).UIMessage;

/** One thread per (owner, dashboard); save replaces the whole array so a replayed turn can't duplicate or lose messages. */
@Injectable()
export class ChatThreadStore {
  constructor(private readonly dbs: DbService) {}

  async load(ownerEmail: string, dashboardId: string): Promise<UIMessage[]> {
    const [row] = await this.dbs.db
      .select({ messages: chatThreads.messages })
      .from(chatThreads)
      .where(and(eq(chatThreads.ownerEmail, ownerEmail), eq(chatThreads.dashboardId, dashboardId)));
    return (row?.messages as UIMessage[] | undefined) ?? [];
  }

  async save(ownerEmail: string, dashboardId: string, messages: UIMessage[], title?: string): Promise<void> {
    const set = { messages, updatedAt: new Date().toISOString(), ...(title !== undefined && { title }) };
    await this.dbs.db
      .insert(chatThreads)
      .values({ ownerEmail, dashboardId, ...set })
      .onConflictDoUpdate({ target: [chatThreads.ownerEmail, chatThreads.dashboardId], set });
  }

  async list(ownerEmail: string): Promise<{ dashboardId: string; title: string | null; updatedAt: string | null }[]> {
    return this.dbs.db
      .select({ dashboardId: chatThreads.dashboardId, title: chatThreads.title, updatedAt: chatThreads.updatedAt })
      .from(chatThreads)
      .where(eq(chatThreads.ownerEmail, ownerEmail))
      .orderBy(desc(chatThreads.updatedAt));
  }
}
