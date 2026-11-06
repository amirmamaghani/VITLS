import { useParams } from "react-router";

import { MetricDetail } from "@/components/health-data/MetricDetail";
import { APP_TITLE } from "@/lib/app-config";

export function meta({ params }: { params: { key?: string } }) {
  return [{ title: `${params.key ?? "Data"} - ${APP_TITLE}` }];
}

export default function DataKeyRoute() {
  const { key = "" } = useParams();
  // Keyed by the metric so a key change remounts the hook state (no stale window from the previous metric).
  return <MetricDetail key={key} dataKey={key} />;
}
