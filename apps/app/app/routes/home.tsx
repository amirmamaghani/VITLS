import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useEffect } from "react";
import { useNavigate } from "react-router";

import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: APP_TITLE }];
}

/** `/home` is the most recently updated dashboard; the first one is created by list-dashboards. */
export default function HomeRoute() {
  const navigate = useNavigate();
  const t = useT();
  const boards = useActionQuery("list-dashboards", {} as never);
  const first = (boards.data as { id: string }[] | undefined)?.[0];
  useEffect(() => {
    if (first) navigate(`/dashboard/${encodeURIComponent(first.id)}`, { replace: true });
  }, [first, navigate]);
  if (boards.error) {
    return <div className="flex h-full items-center justify-center px-6 py-6 text-sm text-muted-foreground">{t("pages.dashboardsUnavailable")}</div>;
  }
  return <div className="px-6 py-6" aria-busy="true" />;
}
