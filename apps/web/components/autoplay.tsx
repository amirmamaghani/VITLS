"use client";

import {
  useEffect,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";

/*
 * Shared autoplay for the switchers (audiences, coach personas): advance every few
 * seconds while the section is on screen, hold while hovered or focused, and never
 * for people who asked for reduced motion. A countdown ring shows the time left.
 */

const CYCLE_SECONDS = 6;
const RING = 2 * Math.PI * 9;

const reducedMotion = "(prefers-reduced-motion: reduce)";
const subscribe = (cb: () => void) => {
  const mq = matchMedia(reducedMotion);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

export function useCycle<T>(keys: readonly T[]) {
  const [active, setActive] = useState<T>(keys[0]);
  // False during SSR, so the first paint matches the server.
  const autoplay = useSyncExternalStore(
    subscribe,
    () => !matchMedia(reducedMotion).matches,
    () => false,
  );
  const [watched, watch] = useState<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [seen, setSeen] = useState(false);
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (!watched) return;
    const io = new IntersectionObserver(
      ([e]) => {
        setVisible(e.isIntersecting);
        if (e.isIntersecting) setSeen(true);
      },
      {
        threshold: 0.35,
      },
    );
    io.observe(watched);
    return () => io.disconnect();
  }, [watched]);

  const step = (by: number) =>
    setActive((a) => keys[(keys.indexOf(a) + by + keys.length) % keys.length]);

  return {
    active,
    setActive,
    autoplay,
    running: autoplay && visible && !held,
    /** True once the section has been on screen; gate the first reveal on it. */
    seen,
    advance: () => step(1),
    /** Ref callback for the element whose visibility gates the cycle. */
    watch,
    /** Spread on the interactive area: hover or focus holds the current item. */
    holdProps: {
      onMouseEnter: () => setHeld(true),
      onMouseLeave: () => setHeld(false),
      onFocus: () => setHeld(true),
      onBlur: () => setHeld(false),
    },
    /** Tabs pattern: arrow keys move between items; returns the new index to focus. */
    onArrowKey: (e: KeyboardEvent, index: number) => {
      const by = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[
        e.key
      ];
      if (!by) return null;
      e.preventDefault();
      step(by);
      return (index + by + keys.length) % keys.length;
    },
  };
}

/** Closes over CYCLE_SECONDS, then calls onDone. Remount (key) to restart it. */
export function CountdownRing({
  running,
  onDone,
  className = "",
}: {
  running: boolean;
  onDone: () => void;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={`size-6 -rotate-90 ${className}`}
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.15"
        strokeWidth="3"
      />
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={RING}
        onAnimationEnd={onDone}
        style={{
          ["--ring" as string]: RING,
          animation: `ring-fill ${CYCLE_SECONDS}s linear forwards`,
          animationPlayState: running ? "running" : "paused",
        }}
      />
    </svg>
  );
}
