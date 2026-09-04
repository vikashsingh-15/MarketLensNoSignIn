export function Loading() { return <div className="loading"><div className="spinner"/>Loading market intelligence…</div>; }
export function EmptyState({ children }: { children: string }) { return <div className="empty-state">{children}</div>; }
