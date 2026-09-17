export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground rounded-md border border-dashed p-8 text-center text-sm">
      {children}
    </div>
  );
}
