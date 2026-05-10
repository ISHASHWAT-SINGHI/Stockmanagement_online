import { useEffect, useMemo, useState } from 'react';
import { BookUser, ReceiptText } from 'lucide-react';
import { getAccountingSummary, getCustomerLedger, getCustomerLedgerOverview } from '../api';
import { useToast } from '../hooks/useToast';
import ModuleTabs from '../components/ModuleTabs';

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

export default function CustomerLedger() {
    const { addToast } = useToast();
    const [searchQuery, setSearchQuery] = useState('');
    const [loading, setLoading] = useState(true);
    const [detailLoading, setDetailLoading] = useState(false);
    const [rows, setRows] = useState([]);
    const [summary, setSummary] = useState({ total_customer_receivable: 0, total_supplier_payable: 0, net_position: 0 });
    const [selectedCustomerId, setSelectedCustomerId] = useState(null);
    const [selectedLedger, setSelectedLedger] = useState(null);

    useEffect(() => {
        let active = true;
        const loadOverview = async () => {
            setLoading(true);
            try {
                const [overviewResponse, summaryResponse] = await Promise.all([
                    getCustomerLedgerOverview({ search: searchQuery || undefined, limit: 200 }),
                    getAccountingSummary(),
                ]);
                if (!active) return;
                setRows(overviewResponse.data.items || []);
                setSummary(summaryResponse.data);
                setSelectedCustomerId((current) => {
                    if (current && (overviewResponse.data.items || []).some((item) => item.customer_id === current)) return current;
                    return overviewResponse.data.items?.[0]?.customer_id || null;
                });
            } catch (error) {
                if (active) addToast(getApiErrorMessage(error, 'Failed to load customer ledger overview'), 'error');
            } finally {
                if (active) setLoading(false);
            }
        };
        loadOverview();
        return () => {
            active = false;
        };
    }, [addToast, searchQuery]);

    useEffect(() => {
        if (!selectedCustomerId) {
            setSelectedLedger(null);
            return;
        }
        let active = true;
        const loadDetail = async () => {
            setDetailLoading(true);
            try {
                const response = await getCustomerLedger(selectedCustomerId, 25);
                if (active) setSelectedLedger(response.data);
            } catch (error) {
                if (active) addToast(getApiErrorMessage(error, 'Failed to load customer ledger details'), 'error');
            } finally {
                if (active) setDetailLoading(false);
            }
        };
        loadDetail();
        return () => {
            active = false;
        };
    }, [addToast, selectedCustomerId]);

    const selectedCustomer = useMemo(
        () => rows.find((customer) => customer.customer_id === selectedCustomerId) || null,
        [rows, selectedCustomerId],
    );

    return (
        <div style={{ display: 'grid', gap: '1rem' }}>
            <div>
                <div className="page-header">
                    <div>
                        <h2 style={{ fontSize: '1.15rem', marginBottom: '0.2rem' }}>Customer Ledger</h2>
                    </div>
                </div>
                <ModuleTabs tabs={accountingTabs} />
            </div>

            <div className="surface" style={{ padding: '1rem' }}>
                <div className="form-group" style={{ maxWidth: 360 }}>
                    <label className="form-label">Search Customers</label>
                    <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search by name, phone, or GST" />
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                {[
                    ['Customer Receivable', summary.total_customer_receivable, 'var(--danger)'],
                    ['Supplier Payable', summary.total_supplier_payable, 'var(--warning)'],
                    ['Net Position', summary.net_position, summary.net_position >= 0 ? 'var(--success)' : 'var(--danger)'],
                ].map(([label, value, color]) => (
                    <div key={label} className="surface" style={{ padding: '1rem' }}>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.76rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.35rem' }}>{label}</p>
                        <strong style={{ fontSize: '1.25rem', color }}>{formatCurrency(value)}</strong>
                    </div>
                ))}
            </div>

            <div className="entry-layout" style={{ gridTemplateColumns: 'minmax(0, 1.3fr) minmax(320px, 0.95fr)' }}>
                <div className="surface" style={{ overflow: 'hidden' }}>
                    {loading ? (
                        <div style={{ padding: '1.2rem' }}>
                            {[...Array(6)].map((_, index) => <div key={index} className="skeleton" style={{ height: 40, marginBottom: 8 }} />)}
                        </div>
                    ) : rows.length === 0 ? (
                        <div className="empty-state"><BookUser size={34} /><span>No customers found</span></div>
                    ) : (
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Customer</th>
                                    <th>Phone</th>
                                    <th style={{ textAlign: 'right' }}>Billed</th>
                                    <th style={{ textAlign: 'right' }}>Paid</th>
                                    <th style={{ textAlign: 'right' }}>Credit Notes</th>
                                    <th style={{ textAlign: 'right' }}>Outstanding</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((customer) => {
                                    const isSelected = selectedCustomerId === customer.customer_id;
                                    return (
                                        <tr key={customer.customer_id} onClick={() => setSelectedCustomerId(customer.customer_id)} style={{ cursor: 'pointer' }}>
                                            <td style={{ fontWeight: isSelected ? 700 : 500, color: isSelected ? 'var(--brand)' : undefined }}>{customer.customer_name}</td>
                                            <td>{customer.phone || '—'}</td>
                                            <td style={{ textAlign: 'right' }}>{formatCurrency(customer.total_billed || customer.total_credit || 0)}</td>
                                            <td style={{ textAlign: 'right', color: 'var(--success)' }}>{formatCurrency(customer.total_paid || 0)}</td>
                                            <td style={{ textAlign: 'right', color: 'var(--warning)' }}>{formatCurrency(customer.total_credit_notes || 0)}</td>
                                            <td style={{ textAlign: 'right', color: (customer.outstanding_balance || 0) > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>{formatCurrency(customer.outstanding_balance || 0)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>

                <div style={{ display: 'grid', gap: '1rem' }}>
                    <div className="surface" style={{ padding: '1rem' }}>
                        <p style={{ fontWeight: 700, marginBottom: '0.25rem' }}>{selectedCustomer?.customer_name || 'Customer Ledger'}</p>
                        <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>{selectedCustomer?.phone || 'No phone number recorded'}</p>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
                            {[
                                ['Total Billed', selectedCustomer?.total_billed || selectedCustomer?.total_credit || 0, 'var(--info)'],
                                ['Total Paid', selectedCustomer?.total_paid || 0, 'var(--success)'],
                                ['Credit Notes', selectedCustomer?.total_credit_notes || 0, 'var(--warning)'],
                                ['Outstanding', selectedCustomer?.outstanding_balance || 0, (selectedCustomer?.outstanding_balance || 0) > 0 ? 'var(--danger)' : 'var(--text-muted)'],
                            ].map(([label, value, color]) => (
                                <div key={label} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 12, padding: '0.9rem' }}>
                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.76rem', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</p>
                                    <strong style={{ fontSize: '1.2rem', color }}>{formatCurrency(value)}</strong>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="surface" style={{ padding: '1rem' }}>
                        <p style={{ fontWeight: 600, marginBottom: '0.75rem' }}>Recent Bill History</p>
                        {detailLoading ? (
                            <div>
                                {[...Array(4)].map((_, index) => <div key={index} className="skeleton" style={{ height: 36, marginBottom: 8 }} />)}
                            </div>
                        ) : !selectedLedger?.bills?.length ? (
                            <div className="empty-state" style={{ minHeight: 180 }}><ReceiptText size={30} /><span>No bills for this customer</span></div>
                        ) : (
                            <div style={{ maxHeight: 220, overflowY: 'auto' }} className="scrollbar">
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Bill</th>
                                            <th style={{ textAlign: 'right' }}>Total</th>
                                            <th style={{ textAlign: 'right' }}>Due</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {selectedLedger.bills.map((bill) => (
                                            <tr key={bill.id}>
                                                <td>{bill.bill_number}</td>
                                                <td style={{ textAlign: 'right' }}>{formatCurrency(bill.grand_total)}</td>
                                                <td style={{ textAlign: 'right', color: bill.outstanding_amount > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>{formatCurrency(bill.outstanding_amount)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>

                    <div className="surface" style={{ padding: '1rem' }}>
                        <p style={{ fontWeight: 600, marginBottom: '0.75rem' }}>Recent Payment History</p>
                        {detailLoading ? (
                            <div>
                                {[...Array(4)].map((_, index) => <div key={index} className="skeleton" style={{ height: 36, marginBottom: 8 }} />)}
                            </div>
                        ) : !selectedLedger?.payments?.length ? (
                            <div className="empty-state" style={{ minHeight: 160 }}><ReceiptText size={30} /><span>No recorded payments yet</span></div>
                        ) : (
                            <div style={{ maxHeight: 220, overflowY: 'auto' }} className="scrollbar">
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Date</th>
                                            <th>Mode</th>
                                            <th style={{ textAlign: 'right' }}>Amount</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {selectedLedger.payments.map((payment) => (
                                            <tr key={payment.id}>
                                                <td>{new Date(payment.payment_date).toLocaleDateString('en-IN')}</td>
                                                <td>{payment.payment_mode}</td>
                                                <td style={{ textAlign: 'right', color: 'var(--success)' }}>{formatCurrency(payment.amount)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
