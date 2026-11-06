import { makeMutable } from "react-native-reanimated";

/** Scroll offset of the active main screen. The floating NavBar reads it to hide on scroll-down. */
export const navScrollY = makeMutable(0);
