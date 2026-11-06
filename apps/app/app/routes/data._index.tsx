import { DataCatalog } from "@/components/health-data/DataCatalog";
import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `Data - ${APP_TITLE}` }];
}

export default function DataRoute() {
  return <DataCatalog />;
}
