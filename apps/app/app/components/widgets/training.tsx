import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@agent-native/toolkit/ui/dialog";

import { Empty, Loading, Pill } from "./blocks";
import type { BodyProps } from ".";

export type Session = {
  title: string;
  exercises: { exerciseId: string; name: string; sets: number; reps: string; rir?: number; note?: string; target?: string; steps: string[] }[];
};

/** Today's session from the coach's plan (PULSE "Tréning dnes"): sets × reps in the list, cue and steps in a dialog. No media (licensing). */
export function TrainingBody({ training, loading }: BodyProps<"training">) {
  // The gallery passes the session (or null); on the dashboard it is undefined and read live.
  return training !== undefined ? <TrainingView today={training} loading={loading} /> : <TrainingLive />;
}

function TrainingLive() {
  const query = useActionQuery("get-training-plan", {} as never);
  return <TrainingView today={(query.data as { today: Session | null } | undefined)?.today ?? null} loading={query.isLoading} />;
}

const prescription = (e: Session["exercises"][number]) => `${e.sets}×${e.reps}${e.rir !== undefined ? ` · RIR ${e.rir}` : ""}`;

function TrainingView({ today, loading }: { today: Session | null; loading: boolean }) {
  const t = useT();
  if (loading) return <Loading />;
  if (!today) return <Empty text={t("widgets.empty.training")} />;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground">{t("widgets.pill.today")}</span>
          <span className="text-2xl tracking-tight">{today.title}</span>
        </div>
        {today.exercises.length > 0 && <Pill tone="primary">{t("widgets.pill.exercises", { count: today.exercises.length })}</Pill>}
      </div>
      <ol className="flex flex-col gap-2">
        {today.exercises.map((e, i) => (
          <li key={e.exerciseId}>
            <Dialog>
              <DialogTrigger className="flex w-full items-center gap-3 rounded-2xl bg-background px-4 py-3 text-left text-sm hover:bg-muted">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs text-primary-foreground tabular-nums">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate capitalize">{e.name}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{prescription(e)}</span>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle className="capitalize">{e.name}</DialogTitle>
                  <DialogDescription className="tabular-nums">
                    {prescription(e)}
                    {e.target ? ` · ${e.target}` : ""}
                  </DialogDescription>
                </DialogHeader>
                {e.note && <p className="text-sm text-muted-foreground">{e.note}</p>}
                {e.steps.length > 0 && (
                  <ol className="list-decimal space-y-1 pl-5 text-sm">
                    {e.steps.map((step, j) => (
                      <li key={j}>{step}</li>
                    ))}
                  </ol>
                )}
              </DialogContent>
            </Dialog>
          </li>
        ))}
      </ol>
    </div>
  );
}
