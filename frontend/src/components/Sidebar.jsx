import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import {
    LayoutDashboard, Package, ShoppingCart, Truck, Users,
    ChevronLeft, ChevronRight, BarChart3, Settings
} from 'lucide-react';
import { useKeyboardShortcut } from '../hooks/useKeyboard';

const navItems = [
    { name: 'Dashboard', path: '/', icon: LayoutDashboard, shortcut: '1' },
    { name: 'Products', path: '/products', icon: Package, shortcut: '2' },
    { name: 'Sales', path: '/sales', icon: ShoppingCart, shortcut: '3' },
    { name: 'Purchases', path: '/purchases', icon: Truck, shortcut: '4' },
    { name: 'Contacts', path: '/contacts', icon: Users, shortcut: '5' },
    { name: 'Settings', path: '/settings', icon: Settings, shortcut: '6' },
];

export default function Sidebar() {
    const location = useLocation();
    const navigate = useNavigate();
    const [collapsed, setCollapsed] = useState(false);

    // Alt+1..5 shortcuts
    navItems.forEach(item => {
        // eslint-disable-next-line react-hooks/rules-of-hooks
        useKeyboardShortcut(item.shortcut, () => navigate(item.path));
    });

    return (
        <aside
            style={{
                width: collapsed ? 'var(--sidebar-w-sm)' : 'var(--sidebar-w)',
                transition: 'width var(--transition)',
                flexShrink: 0,
                background: 'var(--bg-surface)',
                borderRight: '1px solid var(--border)',
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
                padding: '1.1rem 1rem',
                borderBottom: '1px solid var(--border)',
                minHeight: '56px',
                overflow: 'hidden',
            }}>
                <div style={{
                    width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                    <BarChart3 size={18} color="#fff" />
                </div>
                {!collapsed && (
                    <span className="sidebar-logo-text" style={{
                        fontWeight: 700, fontSize: '1rem',
                        background: 'linear-gradient(90deg, #6366f1, #a78bfa)',
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
                            title={collapsed ? `${name} (Alt+${shortcut})` : undefined}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '0.65rem',
                                padding: collapsed ? '0.7rem' : '0.65rem 0.8rem',
                                borderRadius: 9,
                                marginBottom: '0.2rem',
                                textDecoration: 'none',
                                justifyContent: collapsed ? 'center' : 'flex-start',
                                background: isActive ? 'var(--accent-light)' : 'transparent',
                                color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                                borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                                transition: 'all var(--transition)',
                                fontWeight: isActive ? 600 : 400,
                                fontSize: '0.875rem',
                            }}
                            onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                            onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                        >
                            <Icon size={18} style={{ flexShrink: 0 }} />
                            {!collapsed && (
                                <span className="sidebar-label" style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden' }}>{name}</span>
                            )}
                            {!collapsed && (
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
                    borderRadius: 9,
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    transition: 'all var(--transition)',
                }}
            >
                {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                {!collapsed && <span style={{ fontSize: '0.75rem', marginLeft: '0.4rem' }}>Collapse</span>}
            </button>
        </aside>
    );
}
