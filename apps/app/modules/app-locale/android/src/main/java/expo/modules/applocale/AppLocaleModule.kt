package expo.modules.applocale

import android.app.LocaleManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.os.LocaleListCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AppLocaleModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AppLocale")

    // Set the per-app language. On API 33+ we set the framework per-app locale directly (the same thing
    // the system "App language" screen does, and what expo-localization reads back); below 33 AppCompat
    // backports it. "" clears back to the system default.
    // Persist the per-app language (survives restart, shown in system Settings, read back by getLocale).
    // We deliberately do NOT recreate the activity — the JS side flips its own i18n store for an instant,
    // leak-free UI update; recreating a Fabric activity mid-session leaks the surface and races HMR.
    Function("setLocale") { tag: String ->
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        appContext.reactContext?.getSystemService(LocaleManager::class.java)?.applicationLocales =
          android.os.LocaleList.forLanguageTags(tag)
      } else {
        Handler(Looper.getMainLooper()).post {
          AppCompatDelegate.setApplicationLocales(LocaleListCompat.forLanguageTags(tag))
        }
      }
    }

    // The currently applied per-app language tag ("" when following the system default).
    Function("getLocale") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        appContext.reactContext?.getSystemService(LocaleManager::class.java)?.applicationLocales?.toLanguageTags() ?: ""
      } else {
        AppCompatDelegate.getApplicationLocales().toLanguageTags()
      }
    }
  }
}
