import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

const titles = {
    '/': 'Dashboard',
    '/products': 'Products',
    '/sales': 'Sales & Billing',
    '/sales/history': 'Sales & Billing',
    '/purchases': 'Purchases',
    '/purchases/history': 'Purchases',
    '/contacts': 'Contacts',
    '/daily-ledger': 'Accounting',
    '/customer-ledger': 'Accounting',
    '/supplier-ledger': 'Accounting',
    '/payments': 'Accounting',
    '/stock-returns': 'Returns & Adjustments',
    '/stock-adjustments': 'Returns & Adjustments',
    '/returns-history': 'Returns & Adjustments',
    '/credit-notes': 'Returns & Adjustments',
    '/sales-returns': 'Sales Returns',
    '/settings': 'Settings',
};

export default function Navbar() {
    const location = useLocation();
    const [time, setTime] = useState(new Date());

    useEffect(() => {
        const timer = setInterval(() => setTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    const title = titles[location.pathname] || 'StockPro';

    return (
        <header style={{
            height: 'var(--topbar-height)', display: 'flex', alignItems: 'center', gap: '1rem',
            padding: '0 1.25rem',
            background: 'color-mix(in oklch, var(--surface-1) 88%, black 12%)',
            borderBottom: '1px solid var(--line-soft)',
            flexShrink: 0,
        }}>
            <h1 style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-strong)', whiteSpace: 'nowrap', letterSpacing: '-0.02em' }}>
                {title}
            </h1>

            <div style={{ flex: 1 }} />

            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                {time.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                &nbsp;&nbsp;
                <strong>{time.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</strong>
            </span>
        </header>
    );
}
