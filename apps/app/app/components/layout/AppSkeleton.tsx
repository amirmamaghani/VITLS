/** First-paint placeholder in the shape of the app shell: glass top bar, dashboard tabs, a card grid. */
export function AppSkeleton() {
  const block = "block animate-pulse rounded-md bg-muted";
  return (
    <div role="status" aria-label="Loading application" className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground">
      <div aria-hidden="true" className="flex h-14 shrink-0 items-center gap-3 border-b border-border/60 px-4 lg:px-6">
        <span className={`${block} h-4 w-16`} />
        <span className={`${block} h-9 w-64 rounded-full`} />
        <span className="ms-auto flex items-center gap-1">
          <span className={`${block} size-9 rounded-full`} />
          <span className={`${block} size-9 rounded-full`} />
          <span className={`${block} size-9 rounded-full`} />
          <span className={`${block} size-9 rounded-full`} />
        </span>
      </div>
      <div aria-hidden="true" className="flex max-w-6xl flex-col gap-8 px-6 py-6">
        <div className="flex items-center gap-3">
          <span className={`${block} h-10 w-80 rounded-full`} />
          <span className={`${block} ms-auto h-10 w-36 rounded-full`} />
        </div>
        <div className="flex flex-col gap-2">
          <span className={`${block} h-3 w-48`} />
          <span className={`${block} h-7 w-96 max-w-full`} />
          <span className={`${block} h-4 w-72 max-w-full`} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <span key={index} className={`${block} h-56 rounded-2xl`} />
          ))}
        </div>
      </div>
    </div>
  );
}
