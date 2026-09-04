import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';

export function StatCard({ label, value, icon: Icon, tone = 'blue', to }: { label: string; value: string | number; icon: LucideIcon; tone?: string; to?: string }) {
  const content = <><div><p>{label}</p><strong>{value}</strong></div><span className={`stat-icon ${tone}`}><Icon size={20}/></span></>;
  return to
    ? <Link className="stat-card stat-card-link" to={to} aria-label={`View ${label.toLowerCase()}`}>{content}</Link>
    : <div className="stat-card">{content}</div>;
}
