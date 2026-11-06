import { Fragment, type ReactNode } from "react";

/** Keeps "GLP-1" on one line in headlines (the hyphen is a break point) while the text stays searchable. */
export function noBreak(text: string, term = "GLP-1"): ReactNode {
  const parts = text.split(term);
  return parts.map((part, i) => (
    <Fragment key={i}>
      {part}
      {i < parts.length - 1 && (
        <span className="whitespace-nowrap">{term}</span>
      )}
    </Fragment>
  ));
}
