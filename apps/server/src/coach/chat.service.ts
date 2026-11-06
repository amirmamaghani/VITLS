import { BadRequestException, HttpException, Injectable } from "@nestjs/common";
import { DashboardStore } from "../dashboard/dashboard.store";
import { DbService } from "../common/db/db.service";
import { DevicesService } from "../devices/devices.service";
import { PushService } from "../devices/push.service";
import { ExercisesService } from "../exercises/exercises.service";
import { HealthService } from "../health/health.service";
import { FoodsService } from "../meals/foods.service";
import { MealsService } from "../meals/meals.service";
import { ChatThreadStore } from "./chat-thread.store";
import { CoachService } from "./coach.service";
import { MemoriesService } from "./memories.service";
import { coachModel } from "./model";
import { coachSystem } from "./prompt";
import { buildCoachTools } from "./tools";

type UIMessage = import("ai", { with: { "resolution-mode": "import" } }).UIMessage;

/** A ChatGPT-style thread title from the first user message: its text, whitespace-collapsed, capped at ~48 chars on a word boundary. */
export function deriveThreadTitle(messages: UIMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  const text = (first?.parts ?? [])
    .map((p) => (p.type === "text" ? p.text : ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "New chat";
  if (text.length <= 48) return text;
  const cut = text.slice(0, 48);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > 20 ? cut.slice(0, sp) : cut).trim()}…`;
}

/** Merge the client's newly-sent message(s) into the stored thread. The client sends only new messages
    (useChat's slice(-1)); append any whose id isn't already stored. Append — never a Map keyed by id — so
    prior messages keep their order and none collapse when ids repeat or are empty (older threads have
    assistant messages with empty ids, which a Map would merge into one and silently drop). */
export function mergeThread(prior: UIMessage[], incoming: UIMessage[]): UIMessage[] {
  const have = new Set(prior.map((m) => m.id).filter(Boolean));
  const added = incoming.filter((m) => m.id && !have.has(m.id));
  return [...prior, ...added];
}

@Injectable()
export class ChatService {
  constructor(
    private readonly threads: ChatThreadStore,
    private readonly db: DbService,
    private readonly coach: CoachService,
    private readonly health: HealthService,
    private readonly foods: FoodsService,
    private readonly meals: MealsService,
    private readonly exercises: ExercisesService,
    private readonly dashboards: DashboardStore,
    private readonly devices: DevicesService,
    private readonly memories: MemoriesService,
    private readonly push: PushService,
  ) {}

  /** One agent turn. The thread is written only when the turn completes, so a dropped connection leaves it intact. */
  async stream(ownerEmail: string, { dashboardId, messages }: { dashboardId: string; messages: UIMessage[] }, abortSignal?: AbortSignal): Promise<Response> {
    const prior = await this.threads.load(ownerEmail, dashboardId);
    const uiMessages = mergeThread(prior, messages as UIMessage[]);

    const { streamText, stepCountIs, convertToModelMessages, generateId } = await import("ai");
    let model;
    try {
      model = await coachModel();
    } catch (e) {
      throw e instanceof HttpException && e.getStatus() === 503 ? e : unavailable();
    }
    let modelMessages;
    try {
      modelMessages = convertToModelMessages(uiMessages);
    } catch {
      throw new BadRequestException("Malformed messages");
    }
    const lastUser = [...uiMessages].reverse().find((m) => m.role === "user");
    const query = (lastUser?.parts ?? []).map((p) => (p.type === "text" ? p.text : "")).join(" ");
    const result = streamText({
      model,
      abortSignal, // client disconnect must stop the model + tool loop, or tool writes land without a persisted thread
      system: await coachSystem(ownerEmail, this.coach, this.db, { memories: this.memories, query }),
      messages: modelMessages,
      tools: await buildCoachTools(ownerEmail, { coach: this.coach, health: this.health, foods: this.foods, meals: this.meals, exercises: this.exercises, dashboards: this.dashboards, devices: this.devices, memories: this.memories, push: this.push }),
      stopWhen: stepCountIs(8),
    });
    return result.toUIMessageStreamResponse({
      originalMessages: uiMessages,
      generateMessageId: generateId, // assistant messages must get a stable unique id, or they persist with "" and collapse on merge
      onFinish: async ({ messages: full, isAborted, outcome }) => {
        if (isAborted || outcome.status !== "completed") return;
        const title = prior.length === 0 ? deriveThreadTitle(full) : undefined; // auto-title a brand-new thread; later turns leave the title untouched
        await this.threads.save(ownerEmail, dashboardId, full, title);
      },
    });
  }
}

const unavailable = () => new HttpException({ error: "Coach is unavailable", errorCode: "coach_unavailable" }, 503);
