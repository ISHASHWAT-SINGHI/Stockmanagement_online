import { useEffect, useMemo, useState } from 'react';
import { BookMarked, CreditCard, Save, Truck } from 'lucide-react';
import { createSupplierPayment, getAccountingSummary, getSupplierLedger, getSupplierLedgerOverview } from '../api';
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

export default function SupplierLedger() {
    const { addToast } = useToast();
    const [searchQuery, setSearchQuery] = useState('');
    const [loading, setLoading] = useState(true);
    const [detailLoading, setDetailLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [rows, setRows] = useState([]);
    const [summary, setSummary] = useState({ total_customer_receivable: 0, total_supplier_payable: 0, net_position: 0 });
    const [selectedSupplierId, setSelectedSupplierId] = useState(null);
    const [selectedLedger, setSelectedLedger] = useState(null);
    const [paymentForm, setPaymentForm] = useState({ amount: '', payment_mode: 'Cash', notes: '', reference_number: '' });

    const loadOverview = async () => {
        setLoading(true);
        try {
            const [overviewResponse, summaryResponse] = await Promise.all([
                getSupplierLedgerOverview({ search: searchQuery || undefined, limit: 200 }),
                getAccountingSummary(),
            ]);
            setRows(overviewResponse.data.items || []);
            setSummary(summaryResponse.data);
            setSelectedSupplierId((current) => {
                if (current && (overviewResponse.data.items || []).some((item) => item.supplier_id === current)) return current;
                return overviewResponse.data.items?.[0]?.supplier_id || null;
            });
        } catch (error) {
            addToast(getApiErrorMessage(error, 'Failed to load supplier ledger overview'), 'error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadOverview();
    }, [searchQuery]);

    useEffect(() => {
        if (!selectedSupplierId) {
            setSelectedLedger(null);
            return;
        }
        let active = true;
        const loadDetail = async () => {
            setDetailLoading(true);
            try {
                const response = await getSupplierLedger(selectedSupplierId, 25);
                if (active) setSelectedLedger(response.data);
            } catch (error) {
                if (active) addToast(getApiErrorMessage(error, 'Failed to load supplier ledger details'), 'error');
            } finally {
                if (active) setDetailLoading(false);
            }
        };
        loadDetail();
        return () => {
            active = false;
        };
    }, [addToast, selectedSupplierId]);

    const selectedSupplier = useMemo(
        () => rows.find((supplier) => supplier.supplier_id === selectedSupplierId) || null,
        [rows, selectedSupplierId],
    );

    const recordSupplierPayment = async () => {
        if (!selectedSupplierId) {
            addToast('Select a supplier first.', 'error');
            return;
        }
        if (!paymentForm.amount || Number(paymentForm.amount) <= 0) {
            addToast('Enter a valid supplier payment amount.', 'error');
            return;
        }

        setSaving(true);
        try {
            await createSupplierPayment({
                supplier_id: selectedSupplierId,
                amount: Number(paymentForm.amount),
                payment_mode: paymentForm.payment_mode,
                notes: paymentForm.notes.trim() || null,
                reference_number: paymentForm.reference_number.trim() || null,
            });
            addToast('Supplier payment recorded.', 'success');
            setPaymentForm({ amount: '', payment_mode: 'Cash', notes: '', reference_number: '' });
            await loadOverview();
            const response = await getSupplierLedger(selectedSupplierId, 25);
            setSelectedLedger(response.data);
        } catch (error) {
            addToast(getApiErrorMessage(error, 'Failed to record supplier payment'), 'error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div style={{ display: 'grid', gap: '1rem' }}>
            <ModuleTabs tabs={accountingTabs} />

            <div className="surface" style={{ padding: '1rem' }}>
                <div className="form-group" style={{ maxWidth: 360 }}>
                    <label className="form-label">Search Suppliers</label>
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

            <div className="entry-layout" style={{ gridTemplateColumns: 'minmax(0, 1.3fr) minmax(340px, 0.95fr)' }}>
                <div className="surface" style={{ overflow: 'hidden' }}>
                    {loading ? (
                        <div style={{ padding: '1.2rem' }}>
                            {[...Array(6)].map((_, index) => <div key={index} className="skeleton" style={{ height: 40, marginBottom: 8 }} />)}
                        </div>
                    ) : rows.length === 0 ? (
                        <div className="empty-state"><Truck size={34} /><span>No suppliers found</span></div>
                    ) : (
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Supplier</th>
                                    <th>Phone</th>
                                    <th style={{ textAlign: 'right' }}>Purchases</th>
                                    <th style={{ textAlign: 'right' }}>Paid</th>
                                    <th style={{ textAlign: 'right' }}>Returns</th>
                                    <th style={{ textAlign: 'right' }}>Outstanding</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((supplier) => {
                                    const isSelected = selectedSupplierId === supplier.supplier_id;
                                    return (
                                        <tr key={supplier.supplier_id} onClick={() => setSelectedSupplierId(supplier.supplier_id)} style={{ cursor: 'pointer' }}>
                                            <td style={{ fontWeight: isSelected ? 700 : 500, color: isSelected ? 'var(--brand)' : undefined }}>{supplier.company_name}</td>
                                            <td>{supplier.phone || '—'}</td>
                                            <td style={{ textAlign: 'right' }}>{formatCurrency(supplier.total_purchases || 0)}</td>
                                            <td style={{ textAlign: 'right', color: 'var(--success)' }}>{formatCurrency(supplier.total_paid || 0)}</td>
                                            <td style={{ textAlign: 'right', color: 'var(--warning)' }}>{formatCurrency(supplier.total_returns || 0)}</td>
                                            <td style={{ textAlign: 'right', color: (supplier.outstanding_balance || 0) > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>{formatCurrency(supplier.outstanding_balance || 0)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>

                <div style={{ display: 'grid', gap: '1rem' }}>
                    <div className="surface" style={{ padding: '1rem' }}>
                        <p style={{ fontWeight: 700, marginBottom: '0.25rem' }}>{selectedSupplier?.company_name || 'Supplier Ledger'}</p>
                        <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>{selectedSupplier?.phone || 'No phone number recorded'}</p>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
                            {[
                                ['Total Purchases', selectedSupplier?.total_purchases || 0, 'var(--info)'],
                                ['Total Paid', selectedSupplier?.total_paid || 0, 'var(--success)'],
                                ['Stock Returns', selectedSupplier?.total_returns || 0, 'var(--warning)'],
                                ['Outstanding', selectedSupplier?.outstanding_balance || 0, (selectedSupplier?.outstanding_balance || 0) > 0 ? 'var(--danger)' : 'var(--text-muted)'],
                            ].map(([label, value, color]) => (
                                <div key={label} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 12, padding: '0.9rem' }}>
                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.76rem', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</p>
                                    <strong style={{ fontSize: '1.2rem', color }}>{formatCurrency(value)}</strong>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="surface" style={{ padding: '1rem', display: 'grid', gap: '0.8rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                            <CreditCard size={16} color="var(--text-muted)" />
                            <p style={{ fontWeight: 600 }}>Record Supplier Payment</p>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
                            <div className="form-group">
                                <label className="form-label">Amount</label>
                                <input type="number" min={0} step={0.01} value={paymentForm.amount} onChange={(event) => setPaymentForm((current) => ({ ...current, amount: event.target.value }))} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Mode</label>
                                <select value={paymentForm.payment_mode} onChange={(event) => setPaymentForm((current) => ({ ...current, payment_mode: event.target.value }))}>
                                    <option value="Cash">Cash</option>
                                    <option value="UPI">UPI</option>
                                    <option value="Card">Card</option>
                                    <option value="Credit">Credit</option>
                                </select>
                            </div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
                            <div className="form-group">
                                <label className="form-label">Reference</label>
                                <input value={paymentForm.reference_number} onChange={(event) => setPaymentForm((current) => ({ ...current, reference_number: event.target.value }))} placeholder="Optional ref." />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Notes</label>
                                <input value={paymentForm.notes} onChange={(event) => setPaymentForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Optional note" />
                            </div>
                        </div>
                        <button className="btn btn-primary" onClick={recordSupplierPayment} disabled={saving || !selectedSupplierId}>
                            <Save size={14} /> {saving ? 'Saving...' : 'Record Payment'}
                        </button>
                    </div>

                    <div className="surface" style={{ padding: '1rem' }}>
                        <p style={{ fontWeight: 600, marginBottom: '0.75rem' }}>Recent Invoice History</p>
                        {detailLoading ? (
                            <div>
                                {[...Array(4)].map((_, index) => <div key={index} className="skeleton" style={{ height: 36, marginBottom: 8 }} />)}
                            </div>
                        ) : !selectedLedger?.invoices?.length ? (
                            <div className="empty-state" style={{ minHeight: 160 }}><BookMarked size={30} /><span>No purchase invoices for this supplier</span></div>
                        ) : (
                            <div style={{ maxHeight: 220, overflowY: 'auto' }} className="scrollbar">
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Invoice</th>
                                            <th>Date</th>
                                            <th style={{ textAlign: 'right' }}>Amount</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {selectedLedger.invoices.map((invoice) => (
                                            <tr key={invoice.id}>
                                                <td>{invoice.invoice_number}</td>
                                                <td>{new Date(invoice.invoice_date).toLocaleDateString('en-IN')}</td>
                                                <td style={{ textAlign: 'right' }}>{formatCurrency(invoice.total_amount)}</td>
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
