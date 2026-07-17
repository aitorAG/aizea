export default function FiguresLoading() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <div className="h-5 w-28 bg-muted rounded-lg animate-pulse" />
        <div className="flex items-start justify-between mt-2">
          <div className="space-y-2">
            <div className="h-8 w-48 bg-muted rounded-lg animate-pulse" />
            <div className="h-5 w-40 bg-muted rounded-lg animate-pulse" />
          </div>
          <div className="h-9 w-40 bg-muted rounded-lg animate-pulse" />
        </div>
      </div>

      {/* Figure grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="space-y-3 rounded-lg border border-border p-3">
            <div className="aspect-[4/3] bg-muted rounded-lg animate-pulse" />
            <div className="h-4 w-full bg-muted rounded-lg animate-pulse" />
            <div className="h-4 w-2/3 bg-muted rounded-lg animate-pulse" />
            <div className="flex gap-1">
              <div className="h-5 w-12 bg-muted rounded-lg animate-pulse" />
              <div className="h-5 w-12 bg-muted rounded-lg animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
