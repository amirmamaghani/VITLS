import type { HTMLAttributes, ReactNode } from "react";

/**
 * The coach conversation without chat-window chrome: messages are bubbles (coach white
 * on the left, user ink on the right), and the coach's answer lands as large type
 * under its name.
 */

function LiveStatus({ label }: { label: string }) {
  return (
    <span className="flex items-center gap-2 text-sm font-semibold text-graphite">
      <span className="relative flex size-2">
        <span className="absolute inset-0 animate-ping rounded-full bg-[#1e8e3e] opacity-60 motion-reduce:hidden" />
        <span className="relative size-2 rounded-full bg-[#1e8e3e]" />
      </span>
      {label}
    </span>
  );
}

export function Bubble({
  from,
  children,
  className = "",
  ...rest
}: HTMLAttributes<HTMLParagraphElement> & { from: "coach" | "user" }) {
  const side =
    from === "user"
      ? "self-end rounded-br-lg bg-ink text-paper"
      : "self-start rounded-bl-lg bg-paper text-ink shadow-[0_1px_2px_rgba(32,33,36,0.06)]";
  return (
    <p
      {...rest}
      className={`w-fit max-w-[88%] rounded-[1.75rem] px-6 py-4 text-[clamp(1.0625rem,1.4vw,1.25rem)] leading-snug font-medium text-pretty ${side} ${className}`}
    >
      {children}
    </p>
  );
}

/**
 * The coach's answer. `[data-answer-label]`, `[data-answer-text]` and the optional
 * `[data-typing]` dots (drawn where the text will appear, so nothing shifts) are the
 * animation hooks.
 */
export function Answer({
  name,
  status,
  typing = false,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & {
  name: string;
  status?: string;
  typing?: boolean;
  children: ReactNode;
}) {
  return (
    <div {...rest} className="flex flex-col gap-3">
      <span
        data-answer-label
        className="flex flex-wrap items-center gap-x-4 gap-y-1"
      >
        <span className="headline text-lg">{name}</span>
        {status && <LiveStatus label={status} />}
      </span>
      <div className="relative">
        {typing && (
          <span
            data-typing
            aria-hidden
            className="invisible absolute top-3 left-0 flex gap-1.5"
          >
            {[0, 1, 2].map((d) => (
              <span key={d} className="size-2.5 rounded-full bg-ink/50" />
            ))}
          </span>
        )}
        <p
          data-answer-text
          className="text-[clamp(1.375rem,2.4vw,2.125rem)] leading-[1.2] font-semibold tracking-[-0.015em] text-pretty"
        >
          {children}
        </p>
      </div>
    </div>
  );
}
