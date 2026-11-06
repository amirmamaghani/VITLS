import "reflect-metadata";
import { createApp } from "./app.factory";

async function bootstrap() {
  const app = await createApp();
  await app.listen(Number(process.env.PORT ?? 3001), "0.0.0.0"); // all interfaces so a phone on the LAN can reach it
}
void bootstrap();
