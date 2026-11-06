import { NativeModule, requireNativeModule } from "expo";

declare class AppLocaleModule extends NativeModule {
  setLocale(tag: string): void;
  getLocale(): string;
}

export default requireNativeModule<AppLocaleModule>("AppLocale");
