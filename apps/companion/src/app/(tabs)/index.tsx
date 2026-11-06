import { router, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { AppState, Button, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { getToday, MISSING_HINTS, quickLog, type TodayView } from "@/api";
import { disconnect, loadState, syncOrDisconnect, type State } from "@/sync";
import { formatMinutes, formatSyncAge, isStale } from "@/today";

export default function Today() {
  const [state, setState] = useState<State | null>();
  const [view, setView] = useState<TodayView>();
  const [weight, setWeight] = useState("");
  const [note, setNote] = useState<string>();
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false); // a ref, so a double tap before the re-render is still ignored
  const syncing = useRef(false); // focus and app-resume can fire together; one sync at a time

  /** Opening the screen (or returning to the app) pushes this phone's data first when the last sync is stale, then loads Today. */
  const load = useCallback(async () => {
    let s = (await loadState()) ?? null;
    setState(s);
    if (!s) return;
    if (isStale(s.lastSyncAt) && !syncing.current) {
      syncing.current = true;
      try {
        s = await syncOrDisconnect(s);
      } finally {
        syncing.current = false;
      }
      setState(s);
      if (!s) return;
      if (s.lastError) setNote(`Sync failed: ${s.lastError}`);
    }
    try {
      setView(await getToday(s));
    } catch (e) {
      if ((e as Error).message === "unauthorized") {
        await disconnect();
        setState(null);
      } else setNote((e as Error).message);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load();
      const sub = AppState.addEventListener("change", (status) => status === "active" && void load());
      return () => sub.remove();
    }, [load]),
  );

  if (state === undefined) return null;
  if (state === null)
    return (
      <View style={styles.screen}>
        <Text style={styles.body}>VITLS reads your health data from this phone and shows your coach’s plan for today.</Text>
        <Button title="Sign in" onPress={() => router.push("/login")} />
      </View>
    );

  const kg = Number(weight.replace(",", "."));
  const validWeight = kg > 0 && kg < 700;
  const log = async (entries: { metric: string; value: number; unit?: string }[]) => {
    if (inFlight.current) return; // ignore taps while a request is pending
    inFlight.current = true;
    setSaving(true);
    try {
      await quickLog(state, entries.map((e) => ({ ...e, date: view?.date ?? new Date().toISOString().slice(0, 10) })));
      setNote("Saved.");
      setWeight("");
      void load();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      {view?.readout ? (
        <View style={styles.card}>
          {view.readout.greeting ? <Text style={styles.title}>{view.readout.greeting}</Text> : null}
          <Text style={styles.body}>{view.readout.directive}</Text>
          {view.readout.highlights.map((h) => (
            <Text key={h.metric} style={styles.small}>
              {h.metric}: {h.note}
            </Text>
          ))}
        </View>
      ) : (
        <Text style={styles.body}>No readout yet. Your coach writes one every morning.</Text>
      )}
      <View style={styles.row}>
        <Stat label="Steps" value={view?.metrics.steps?.toLocaleString() ?? "–"} />
        <Stat label="Sleep" value={view?.metrics.sleep_min !== undefined ? formatMinutes(view.metrics.sleep_min) : "–"} />
        <Stat label="Resting HR" value={view?.metrics.resting_hr !== undefined ? `${view.metrics.resting_hr} bpm` : "–"} />
      </View>
      <Text style={styles.small}>Data from this phone: {formatSyncAge(view?.lastBatchAt ?? state.lastSyncAt ?? null)}</Text>
      {view?.missing.map((m) => (
        <Text key={m} style={styles.small}>
          Missing for your goals: {MISSING_HINTS[m] ?? m}
        </Text>
      ))}
      <View style={styles.card}>
        <Text style={styles.title}>Quick log</Text>
        <View style={styles.row}>
          <TextInput style={styles.input} value={weight} onChangeText={setWeight} placeholder="Weight, kg" keyboardType="decimal-pad" />
          <Button title={saving ? "Saving…" : "Save"} onPress={() => log([{ metric: "weight", value: kg, unit: "kg" }])} disabled={saving || !validWeight} />
        </View>
        {note ? <Text style={styles.small}>{note}</Text> : null}
      </View>
      <Text style={styles.small}>VITLS is a coach, not a doctor. Nothing here is medical advice.</Text>
    </ScrollView>
  );
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <View style={styles.stat}>
    <Text style={styles.title}>{value}</Text>
    <Text style={styles.small}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  screen: { padding: 24, gap: 16 },
  card: { gap: 8, padding: 16, borderRadius: 12, backgroundColor: "#f3f4f6" },
  row: { flexDirection: "row", gap: 12, alignItems: "center", flexWrap: "wrap" },
  stat: { flex: 1, alignItems: "center" },
  title: { fontSize: 18, fontWeight: "600" },
  body: { fontSize: 16 },
  small: { fontSize: 13, color: "#555" },
  input: { flex: 1, borderWidth: 1, borderColor: "#999", borderRadius: 8, padding: 10, fontSize: 16 },
});
