import { useEffect, useState } from 'react';
import { CalendarDays, RefreshCw, Download } from 'lucide-react';
import { getAccountingSummary, getDailyLedger } from '../api';
import { useToast } from '../hooks/useToast';
import ModuleTabs from '../components/ModuleTabs';

function getToday() {
    return new Date().toISOString().slice(0, 10);
}

function formatCurrency(value) {
    return `Rs ${Number(value || 0).toFixed(2)}`;
}

function getApiErrorMessage(error, fallback) {
    const message = error?.response?.data?.detail || error?.message || fallback;
    const requestId = error?.response?.headers?.['x-request-id'] || error?.response?.data?.request_id;
    return requestId ? `${message} (Ref: ${requestId})` : message;
}

const accountingTabs = [
    { label: 'Daily Ledger', path: '/daily-ledger' },
    { label: 'Customer Ledger', path: '/customer-ledger' },
    { label: 'Supplier Ledger', path: '/supplier-ledger' },
    { label: 'Payments', path: '/payments' },
];

export default function DailyLedger() {
    const { addToast } = useToast();
    const [ledgerDate, setLedgerDate] = useState(getToday());
    const [loading, setLoading] = useState(true);
    const [ledger, setLedger] = useState(null);
    const [summary, setSummary] = useState({ total_customer_receivable: 0, total_supplier_payable: 0, net_position: 0 });
    const [refreshTick, setRefreshTick] = useState(0);

    useEffect(() => {
        let active = true;
        setLoading(true);
        Promise.all([getDailyLedger(ledgerDate), getAccountingSummary()])
            .then(([ledgerResponse, summaryResponse]) => {
                if (!active) return;
                setLedger(ledgerResponse.data);
                setSummary(summaryResponse.data);
            })
            .catch((error) => {
                if (!active) return;
                setLedger(null);
                addToast(getApiErrorMessage(error, 'Failed to load daily ledger'), 'error');
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [ledgerDate, refreshTick, addToast]);

    const statCards = [
        ['Today’s Collection', ledger?.total_collection, 'var(--ledger)'],
        ['Customer Receivable', summary.total_customer_receivable, 'var(--danger)'],
        ['Supplier Payable', summary.total_supplier_payable, 'var(--warning)'],
        ['Net Position', summary.net_position, summary.net_position >= 0 ? 'var(--success)' : 'var(--danger)'],
    ];

    const sections = [
        {
            title: 'Collection Breakdown',
            rows: [
                ['Cash Sales', ledger?.cash_sales],
                ['UPI Sales', ledger?.upi_sales],
                ['Card Sales', ledger?.card_sales],
                ['Collections', ledger?.total_collection],
            ],
        },
        {
            title: 'Credit Sales / Outstanding',
            rows: [
                ['Credit Sales', ledger?.credit_sales],
                ['Outstanding', ledger?.total_outstanding],
            ],
        },
        {
            title: 'Returns and Adjustments',
            rows: [
                ['Sales Returns', ledger?.sales_returns],
                ['Stock Return Credit', ledger?.stock_return_credit],
            ],
        },
        {
            title: 'Payment Method Summary',
            rows: [
                ['Purchase Payments', ledger?.purchase_payments],
                ['Net Movement', Number(ledger?.total_collection || 0) - Number(ledger?.purchase_payments || 0)],
            ],
        },
    ];

    return (
        <div style={{ display: 'grid', gap: '1rem' }}>
            <ModuleTabs tabs={accountingTabs} />

            <div className="surface" style={{ padding: '1rem', display: 'grid', gap: '1rem' }}>
                <div className="ledger-toolbar">
                    <div className="ledger-toolbar__intro">
                        <h2 className="page-title" style={{ fontSize: '1.15rem' }}>Daily Ledger</h2>
                        <p style={{ color: 'var(--text-muted)' }}>End-of-day collections, credit sales, returns, and outstanding summary.</p>
                    </div>
                    <div className="ledger-toolbar__actions">
                        <label className="ledger-toolbar__date">
                            <CalendarDays size={16} color="var(--text-muted)" />
                            <span>Date</span>
                            <input type="date" value={ledgerDate} onChange={(event) => setLedgerDate(event.target.value)} />
                        </label>
                        <button className="btn btn-ghost btn-sm" onClick={() => setRefreshTick((current) => current + 1)}>
                            <RefreshCw size={14} /> Refresh
                        </button>
                        <button className="btn btn-primary btn-sm" onClick={() => window.print()}>
                            <Download size={14} /> Export
                        </button>
                    </div>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                {statCards.map(([label, value, color]) => (
                    <div key={label} className="surface" style={{ padding: '1rem' }}>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.76rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.35rem' }}>{label}</p>
                        <strong style={{ fontSize: '1.25rem', color }}>{formatCurrency(value)}</strong>
                    </div>
                ))}
            </div>

            {loading ? (
                <div className="surface" style={{ padding: '1.2rem' }}>
                    {[...Array(6)].map((_, index) => (
                        <div key={index} className="skeleton" style={{ height: 48, marginBottom: 10 }} />
                    ))}
                </div>
            ) : (
                <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
                        {sections.map((section) => (
                            <div key={section.title} className="surface" style={{ padding: '1rem 1.1rem' }}>
                                <p style={{ fontWeight: 700, marginBottom: '0.75rem' }}>{section.title}</p>
                                <div style={{ display: 'grid', gap: '0.65rem' }}>
                                    {section.rows.map(([label, value]) => (
                                        <div key={label} className="summary-row" style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                                            <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
                                            <strong>{formatCurrency(value)}</strong>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}
