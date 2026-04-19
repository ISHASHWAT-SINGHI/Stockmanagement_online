import { useRef, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { useKeyboardShortcut } from '../hooks/useKeyboard';

const titles = {
    '/': 'Dashboard',
    '/products': 'Products',
    '/sales': 'Sales & Billing',
    '/purchases': 'Purchases',
    '/contacts': 'Contacts',
};

export default function Navbar({ onSearch }) {
    const location = useLocation();
    const searchRef = useRef(null);
    const [query, setQuery] = useState('');
    const [time, setTime] = useState(new Date());

    useEffect(() => {
        const timer = setInterval(() => setTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    useKeyboardShortcut('s', () => searchRef.current?.focus());

    const title = titles[location.pathname] || 'StockPro';

    return (
        <header style={{
            height: 56, display: 'flex', alignItems: 'center', gap: '1rem',
            padding: '0 1.25rem',
            background: 'var(--bg-surface)',
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
        }}>
            {/* Page title */}
            <h1 style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                {title}
            </h1>

            {/* Search */}
            <div style={{
                flex: 1, maxWidth: 380, position: 'relative',
                marginLeft: '0.5rem',
            }}>
                <Search size={15} style={{
                    position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)',
                    color: 'var(--text-muted)', pointerEvents: 'none',
                }} />
                <input
                    ref={searchRef}
                    value={query}
                    onChange={e => { setQuery(e.target.value); onSearch?.(e.target.value); }}
                    placeholder="Search… (Alt+S)"
                    style={{ paddingLeft: '2rem', paddingRight: query ? '2rem' : '0.75rem', fontSize: '0.85rem' }}
                />
                {query && (
                    <button
                        className="btn-icon"
                        onClick={() => { setQuery(''); onSearch?.(''); searchRef.current?.focus(); }}
                        style={{ position: 'absolute', right: '0.4rem', top: '50%', transform: 'translateY(-50%)' }}
                    >
                        <X size={13} />
                    </button>
                )}
            </div>

            {/* Spacer */}
            <div style={{ flex: 1 }} />

            {/* Clock */}
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                {time.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                &nbsp;&nbsp;
                <strong>{time.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</strong>
            </span>
        </header>
    );
}
