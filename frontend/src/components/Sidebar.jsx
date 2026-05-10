import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import {
    LayoutDashboard, Package, ShoppingCart, Truck, Users,
    ChevronLeft, ChevronRight, BarChart3, Settings, RefreshCcw
} from 'lucide-react';
import { useKeyboardShortcut } from '../hooks/useKeyboard';

const navItems = [
    { name: 'Dashboard', path: '/', icon: LayoutDashboard, shortcut: '1' },
    { name: 'Products', path: '/products', icon: Package, shortcut: '2' },
    { name: 'Sales', path: '/sales', icon: ShoppingCart, shortcut: '3' },
    { name: 'Purchases', path: '/purchases', icon: Truck, shortcut: '4' },
    { name: 'Contacts', path: '/contacts', icon: Users, shortcut: '5' },
    { name: 'Accounting', path: '/daily-ledger', icon: BarChart3, shortcut: '6' },
    { name: 'Returns & Adjustments', path: '/stock-returns', icon: RefreshCcw, shortcut: '7' },
    { name: 'Settings', path: '/settings', icon: Settings },
];

export default function Sidebar() {
    const location = useLocation();
    const navigate = useNavigate();
    const [collapsed, setCollapsed] = useState(false);

    // Alt+1..5 shortcuts
    navItems.forEach(item => {
        if (!item.shortcut) return;
        // eslint-disable-next-line react-hooks/rules-of-hooks
        useKeyboardShortcut(item.shortcut, () => navigate(item.path));
    });

    return (
        <aside
            className="scrollbar"
            style={{
                width: collapsed ? 'var(--sidebar-width-compact)' : 'var(--sidebar-width)',
                transition: 'width var(--duration-normal) var(--ease-standard)',
                flexShrink: 0,
                background: 'linear-gradient(180deg, color-mix(in oklch, var(--surface-2) 92%, black 8%), var(--surface-1))',
                borderRight: '1px solid var(--line-soft)',
                boxShadow: '18px 0 42px rgb(0 0 0 / 0.16)',
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                overflow: 'hidden',
                zIndex: 50,
                paddingBottom: '2.75rem', // clears the KbdHint bar height
            }}
        >
            {/* Logo */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: '0.6rem',
                padding: '0 1rem',
                borderBottom: '1px solid var(--line-soft)',
                height: 'var(--topbar-height)',
                background: 'color-mix(in oklch, var(--surface-1) 88%, black 12%)',
                overflow: 'hidden',
                flexShrink: 0,
            }}>
                <div style={{
                    width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                    background: 'linear-gradient(135deg, var(--brand), var(--ledger))',
                    boxShadow: 'var(--glow-brand)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                    <BarChart3 size={18} color="#fff" />
                </div>
                {!collapsed && (
                    <span className="sidebar-logo-text" style={{
                        fontWeight: 700, fontSize: '1rem',
                        background: 'linear-gradient(90deg, var(--text-strong), color-mix(in oklch, var(--brand) 72%, var(--ledger)))',
                        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                        whiteSpace: 'nowrap',
                    }}>
                        StockPro
                    </span>
                )}
            </div>

            {/* Nav items */}
            <nav style={{ flex: 1, padding: '0.75rem 0.6rem', overflowY: 'auto', overflowX: 'hidden' }}>
                {navItems.map(({ name, path, icon: Icon, shortcut }) => {
                    const isActive = location.pathname === path || (path !== '/' && location.pathname.startsWith(path));
                    return (
                        <Link
                            key={name}
                            to={path}
                            title={collapsed ? `${name}${shortcut ? ` (Alt+${shortcut})` : ''}` : undefined}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '0.65rem',
                                padding: collapsed ? '0.7rem' : '0.65rem 0.8rem',
                                borderRadius: 12,
                                marginBottom: '0.3rem',
                                textDecoration: 'none',
                                justifyContent: collapsed ? 'center' : 'flex-start',
                                background: isActive ? 'linear-gradient(90deg, color-mix(in oklch, var(--brand) 14%, transparent), color-mix(in oklch, var(--ledger) 8%, transparent))' : 'transparent',
                                color: isActive ? 'var(--text-strong)' : 'var(--text-secondary)',
                                border: isActive ? '1px solid color-mix(in oklch, var(--brand) 32%, var(--line))' : '1px solid transparent',
                                transition: 'all var(--duration-normal) var(--ease-standard)',
                                fontWeight: isActive ? 600 : 400,
                                fontSize: '0.875rem',
                                boxShadow: isActive ? '0 10px 24px rgb(0 0 0 / 0.16)' : 'none',
                            }}
                            onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'color-mix(in oklch, var(--surface-3) 92%, transparent)'; }}
                            onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                        >
                            <Icon size={18} style={{ flexShrink: 0 }} />
                            {!collapsed && (
                                <span className="sidebar-label" style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden' }}>{name}</span>
                            )}
                            {!collapsed && shortcut && (
                                <kbd className="kbd" style={{ marginLeft: 'auto', opacity: 0.6 }}>Alt+{shortcut}</kbd>
                            )}
                        </Link>
                    );
                })}
            </nav>

            {/* Collapse toggle */}
            <button
                onClick={() => setCollapsed(c => !c)}
                style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    margin: '0.5rem 0.6rem 0.75rem',
                    padding: '0.5rem',
                    borderRadius: 12,
                    background: 'color-mix(in oklch, var(--surface-2) 84%, black 16%)',
                    border: '1px solid var(--line-soft)',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    transition: 'all var(--duration-normal) var(--ease-standard)',
                }}
            >
                {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                {!collapsed && <span style={{ fontSize: '0.75rem', marginLeft: '0.4rem' }}>Collapse</span>}
            </button>
        </aside>
    );
}
