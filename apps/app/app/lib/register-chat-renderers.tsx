import { registerActionChatRenderer, type ToolRendererProps } from "@agent-native/toolkit/app/chat/agentkit-chat/index";

import { HealthWidget } from "@/components/widgets";
import { MealCard } from "@/components/meals/MealCard";

import type { Widget } from "../../shared/dashboard";
import type { MealView } from "../../shared/meals";

// Imported for its side effect from root.tsx (quantal pattern): show-widget results render the same widget as /dashboard.
// Same specifier as the toolkit's own AgentKit surface ("…/agentkit-chat/index"): Vite dev treats specifiers as
// separate modules, and a second copy of the toolkit registry would never see this renderer.
// During a run the toolkit renders a chatUI result twice: once in the run's tool-results block (ToolCallDisplay, whose
// context carries `isActiveTail`) and once as the widget attached to the reply (AgentKitActionWidget). Only the widget
// survives a reload, so the tool cell renders nothing (docs/upstream/agent-native-chat-ui-rendered-twice.md).
const fromToolCell = (context: ToolRendererProps["context"]) => "isActiveTail" in context;

registerActionChatRenderer({
  id: "vitls.widget",
  renderer: "vitls.widget",
  Component: ({ context }: ToolRendererProps) => {
    const widget = (context.resultJson as { widget?: Widget } | undefined)?.widget;
    return widget && !fromToolCell(context) ? <HealthWidget widget={widget} /> : null;
  },
});

registerActionChatRenderer({
  id: "vitls.meal",
  renderer: "vitls.meal",
  Component: ({ context }: ToolRendererProps) => {
    const meal = (context.resultJson as { meal?: MealView } | undefined)?.meal;
    return meal && !fromToolCell(context) ? <MealCard meal={meal} /> : null;
  },
});
