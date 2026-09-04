import { BarChart3, Binoculars, BrainCircuit, CalendarDays, Flame, LayoutDashboard, Menu, Newspaper, ScanSearch, Search, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { ThemeToggle } from '../components/ThemeToggle';

const nav = [
  ['/dashboard', 'Dashboard', LayoutDashboard], ['/news', 'News', Newspaper], ['/hot-stocks', 'Hot Stocks', Flame], ['/stocks', 'Stocks', Search],
  ['/recommendations', 'Recommendations', BarChart3],
  ['/calendar', 'Calendar', CalendarDays],
  ['/strategy-screens', 'Strategy Screens', ScanSearch],
  ['/ai-signals', 'AI & Quant Signals', BrainCircuit],
] as const;
export function AppLayout({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <div className="app-shell">
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <div className="brand"><span className="brand-mark"><Binoculars size={21}/></span><span>MarketLens</span><button className="mobile-close" onClick={() => setOpen(false)} aria-label="Close menu"><X/></button></div>
      <nav>{nav.map(([to, label, Icon]) => <NavLink key={to} to={to} onClick={() => setOpen(false)} className={({ isActive }) => isActive ? 'active' : ''}><Icon size={18}/>{label}</NavLink>)}</nav>
      <ThemeToggle label className="sidebar-theme-toggle"/>
    </aside>
    {open && <button className="backdrop" onClick={() => setOpen(false)} aria-label="Close menu"/>}
    <main><header className="mobile-header"><button onClick={() => setOpen(true)} aria-label="Open menu"><Menu/></button><strong>MarketLens</strong><ThemeToggle className="mobile-theme-toggle"/></header><div className="content">{children}</div>
    <footer>MarketLens aggregates publicly reported analyst and broker recommendations for informational purposes only. It does not provide personalized investment advice. Always verify information with the original source before making investment decisions.</footer></main>
  </div>;
}
