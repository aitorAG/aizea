export default function MaterialsLoading() {
  return (
    <div className="space-y-8">
      {/* Breadcrumb header */}
      <div className="space-y-2">
        <div className="h-5 w-40 bg-muted rounded-lg animate-pulse" />
        <div className="h-8 w-56 bg-muted rounded-lg animate-pulse" />
      </div>

      {/* Materials Section */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="h-5 w-5 bg-muted rounded-lg animate-pulse" />
          <div className="h-6 w-24 bg-muted rounded-lg animate-pulse" />
        </div>

        {/* Upload zone */}
        <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border p-8 space-y-3">
          <div className="h-12 w-12 bg-muted rounded-full animate-pulse" />
          <div className="h-5 w-40 bg-muted rounded-lg animate-pulse" />
          <div className="h-4 w-56 bg-muted rounded-lg animate-pulse" />
          <div className="h-4 w-48 bg-muted rounded-lg animate-pulse" />
        </div>

        {/* File card list */}
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-md border border-border px-4 py-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-4 w-4 bg-muted rounded-lg animate-pulse" />
                <div className="h-5 w-48 bg-muted rounded-lg animate-pulse" />
                <div className="h-5 w-16 bg-muted rounded-lg animate-pulse" />
              </div>
              <div className="h-4 w-20 bg-muted rounded-lg animate-pulse" />
            </div>
          ))}
        </div>
      </section>

      {/* Context Section */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-5 w-5 bg-muted rounded-lg animate-pulse" />
          <div className="h-6 w-40 bg-muted rounded-lg animate-pulse" />
        </div>
        <div className="h-4 w-96 bg-muted rounded-lg animate-pulse" />
        <div className="h-36 w-full bg-muted rounded-lg animate-pulse" />
      </section>

      {/* Bottom actions */}
      <div className="flex items-center justify-between border-t border-border pt-6">
        <div className="h-5 w-20 bg-muted rounded-lg animate-pulse" />
        <div className="h-9 w-40 bg-muted rounded-lg animate-pulse" />
      </div>
    </div>
  );
}
