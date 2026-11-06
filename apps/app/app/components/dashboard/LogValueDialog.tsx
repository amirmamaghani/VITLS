import { actionErrorMessage, useActionMutation } from "@agent-native/core/client/hooks";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@agent-native/toolkit/ui/dialog";

/** Metrics people commonly enter by hand, with the unit they think in (converted server-side). */
const MANUAL_METRICS = [
  { metric: "weight", label: "Weight", unit: "kg" },
  { metric: "body_fat_pct", label: "Body fat", unit: "pct" },
  { metric: "waist", label: "Waist", unit: "cm" },
  { metric: "steps", label: "Steps", unit: "count" },
  { metric: "sleep_duration", label: "Sleep", unit: "h" },
  { metric: "resting_hr", label: "Resting heart rate", unit: "bpm" },
  { metric: "blood_pressure_systolic", label: "Blood pressure (systolic)", unit: "mmHg" },
  { metric: "blood_pressure_diastolic", label: "Blood pressure (diastolic)", unit: "mmHg" },
] as const;

const UNIT_LABEL: Record<string, string> = { pct: "%", count: "", h: "h" };
const today = () => new Date().toLocaleDateString("en-CA");

/** Manual entry modal: the fallback when no tracker provides a value (log-health-data, same action the coach uses). */
export function LogValueDialog() {
  const [open, setOpen] = useState(false);
  const [metric, setMetric] = useState<string>("weight");
  const [value, setValue] = useState("");
  const [date, setDate] = useState(today);
  const log = useActionMutation("log-health-data");
  const def = MANUAL_METRICS.find((m) => m.metric === metric)!;
  const unitLabel = UNIT_LABEL[def.unit] ?? def.unit;

  function submit(event: FormEvent) {
    event.preventDefault();
    const number = Number(value.replace(",", "."));
    if (!Number.isFinite(number)) return;
    log.mutate({ entries: [{ metric, value: number, unit: def.unit, date }] } as never, {
      onSuccess: () => {
        setValue("");
        setOpen(false);
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="rounded-full">Log value</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Log value</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="mt-2 flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="log-metric">Metric</Label>
            <Select value={metric} onValueChange={setMetric}>
              <SelectTrigger id="log-metric">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {MANUAL_METRICS.map((m) => (
                    <SelectItem key={m.metric} value={m.metric}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="log-value">Value{unitLabel ? ` (${unitLabel})` : ""}</Label>
            <Input id="log-value" inputMode="decimal" required value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="log-date">Date</Label>
            <Input id="log-date" type="date" required max={today()} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          {log.error && <p className="text-sm text-destructive">{actionErrorMessage(log.error) ?? "Could not save the value."}</p>}
          <Button type="submit" disabled={log.isPending}>
            Save
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
