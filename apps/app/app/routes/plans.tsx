import { useT } from "@agent-native/core/client/i18n";

import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `Plans - ${APP_TITLE}` }];
}

export default function PlansRoute() {
  const t = useT();
  return <div className="flex h-full items-center justify-center px-6 py-6 text-sm text-muted-foreground">{t("pages.comingSoon")}</div>;
}
