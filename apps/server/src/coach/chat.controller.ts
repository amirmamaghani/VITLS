import { BadRequestException, Body, Controller, Get, Param, Post, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { AuthGuard } from "../common/auth.guard";
import { CurrentUser } from "../common/current-user.decorator";
import { ChatThreadStore } from "./chat-thread.store";
import { ChatService } from "./chat.service";

type UIMessage = import("ai", { with: { "resolution-mode": "import" } }).UIMessage;

@Controller("api/chat")
@UseGuards(AuthGuard)
export class ChatController {
  constructor(private readonly chat: ChatService, private readonly threads: ChatThreadStore) {}

  /** The owner's chats, most-recent first: one per (owner, dashboard), with its auto-title. */
  @Get("threads")
  listThreads(@CurrentUser() owner: string) {
    return this.threads.list(owner);
  }

  /** The stored messages of one chat, to hydrate the screen when opening or switching. */
  @Get("threads/:dashboardId")
  async thread(@CurrentUser() owner: string, @Param("dashboardId") dashboardId: string) {
    return { messages: await this.threads.load(owner, dashboardId) };
  }

  @Post()
  async stream(@CurrentUser() owner: string, @Body() body: { dashboardId?: unknown; messages?: unknown }, @Res() res: Response): Promise<void> {
    const { dashboardId, messages } = body ?? {};
    if (typeof dashboardId !== "string" || !dashboardId.trim()) throw new BadRequestException("dashboardId is required");
    if (!Array.isArray(messages)) throw new BadRequestException("messages must be an array");

    const ac = new AbortController();
    res.on("close", () => ac.abort());
    const response = await this.chat.stream(owner, { dashboardId, messages: messages as UIMessage[] }, ac.signal);
    res.status(response.status);
    response.headers.forEach((v, k) => res.setHeader(k, v));
    const { Readable } = await import("node:stream");
    const out = Readable.fromWeb(response.body as never);
    res.on("close", () => out.destroy());
    out.pipe(res);
  }
}
