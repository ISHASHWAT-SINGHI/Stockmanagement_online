import { useEffect, useMemo, useRef, useState } from 'react';
import { ReceiptText, Save, Search } from 'lucide-react';
import { createSalesReturn, getSale, getSales, getSalesReturns } from '../api';
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

const salesTabs = [
    { label: 'New Bill', path: '/sales', end: true },
    { label: 'Bill History', path: '/sales/history' },
    { label: 'Sales Returns', path: '/sales-returns' },
];

function getBillCustomerLabel(bill) {
    if (bill?.customer?.name) return bill.customer.name;
    if (bill?.customer_id) return `Customer #${bill.customer_id}`;
    return 'Walk-in Customer';
}

export default function SalesReturns() {
    const { addToast } = useToast();
    const searchInputRef = useRef(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [salesReturns, setSalesReturns] = useState([]);
    const [bills, setBills] = useState([]);
    const [selectedBillId, setSelectedBillId] = useState('');
    const [selectedBill, setSelectedBill] = useState(null);
    const [billSearch, setBillSearch] = useState('');
    const [returnDate, setReturnDate] = useState(getToday());
    const [settlementType, setSettlementType] = useState('Customer Credit / Store Credit');
    const [reason, setReason] = useState('');
    const [notes, setNotes] = useState('');
    const [itemForms, setItemForms] = useState({});

    const load = async () => {
        setLoading(true);
        try {
            const [returnsResponse, billsResponse] = await Promise.all([
                getSalesReturns(),
                getSales(),
            ]);
            setSalesReturns(returnsResponse.data);
            setBills(billsResponse.data);
        } catch (error) {
            addToast(getApiErrorMessage(error, 'Failed to load sales returns'), 'error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
    }, []);

    const returnedQuantities = useMemo(() => {
        const summary = {};
        salesReturns.forEach((returnEntry) => {
            (returnEntry.items || []).forEach((item) => {
                summary[item.sale_item_id] = (summary[item.sale_item_id] || 0) + Number(item.quantity || 0);
            });
        });
        return summary;
    }, [salesReturns]);

    const filteredBills = useMemo(() => {
        const query = billSearch.toLowerCase().trim();
        const sorted = [...bills].sort((a, b) => new Date(b.bill_date) - new Date(a.bill_date));
        if (!query) return sorted.slice(0, 10);

        return sorted.filter((bill) => {
            const customerName = bill.customer?.name?.toLowerCase() || '';
            const customerPhone = bill.customer?.phone || '';
            const billNumber = bill.bill_number?.toLowerCase() || '';
            const billDate = new Date(bill.bill_date).toLocaleDateString('en-IN').toLowerCase();
            return (
                billNumber.includes(query) ||
                customerName.includes(query) ||
                customerPhone.includes(query) ||
                billDate.includes(query)
            );
        });
    }, [bills, billSearch]);

    const handleBillSelect = async (value) => {
        const billId = value ? Number(value) : '';
        setSelectedBillId(billId);
        setSelectedBill(null);
        setItemForms({});
        if (!billId) return;

        try {
            const response = await getSale(billId);
            setSelectedBill(response.data);
            const nextItemForms = {};
            (response.data.sales_items || []).forEach((item) => {
                nextItemForms[item.id] = {
                    quantity: '',
                    amount: '',
                    stock_action: 'SELLABLE',
                    reason: '',
                };
            });
            setItemForms(nextItemForms);
        } catch (error) {
            addToast(getApiErrorMessage(error, 'Failed to load bill details'), 'error');
        }
    };

    const updateItemForm = (saleItemId, patch) => {
        setItemForms((current) => ({
            ...current,
            [saleItemId]: {
                ...current[saleItemId],
                ...patch,
            },
        }));
    };

    const saveReturn = async () => {
        if (!selectedBill) {
            addToast('Select a bill to create a return.', 'error');
            return;
        }
        if (!reason.trim()) {
            addToast('Return reason is required.', 'error');
            return;
        }

        let items;
        try {
            items = (selectedBill.sales_items || [])
                .map((item) => {
                    const row = itemForms[item.id] || {};
                    const quantity = Number(row.quantity) || 0;
                    if (quantity <= 0) return null;

                    const alreadyReturned = returnedQuantities[item.id] || 0;
                    const remaining = Math.max(0, Number(item.quantity || 0) - alreadyReturned);
                    if (quantity > remaining) {
                        throw new Error(`Return quantity for ${item.product_name_snapshot || item.product?.product_name || `item #${item.id}`} exceeds remaining quantity ${remaining}.`);
                    }

                    const lineAmount = Number(
                        row.amount || (quantity * ((Number(item.final_amount) || 0) / Math.max(Number(item.quantity) || 1, 1))),
                    );

                    return {
                        sale_item_id: item.id,
                        product_id: item.product_id,
                        quantity,
                        amount: lineAmount,
                        stock_action: row.stock_action || 'SELLABLE',
                        reason: row.reason?.trim() || reason.trim(),
                    };
                })
                .filter(Boolean);
        } catch (error) {
            addToast(getApiErrorMessage(error, error.message || 'Failed to prepare sales return'), 'error');
            return;
        }

        if (!items.length) {
            addToast('Enter at least one return item quantity.', 'error');
            return;
        }

        setSaving(true);
        try {
            await createSalesReturn({
                bill_id: selectedBill.id,
                customer_id: selectedBill.customer_id || null,
                return_date: returnDate,
                reason: reason.trim(),
                settlement_type: settlementType,
                notes: notes.trim() || null,
                items,
            });
            addToast('Sales return saved.', 'success');
            setSelectedBillId('');
            setSelectedBill(null);
            setBillSearch('');
            setReturnDate(getToday());
            setSettlementType('Customer Credit / Store Credit');
            setReason('');
            setNotes('');
            setItemForms({});
            await load();
        } catch (error) {
            addToast(getApiErrorMessage(error, error.message || 'Failed to save sales return'), 'error');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div style={{ display: 'grid', gap: '1rem' }}>
            <div>
                <div className="page-header">
                    <div>
                        <h2 style={{ fontSize: '1.15rem', marginBottom: '0.2rem' }}>Sales Returns</h2>
                        <p style={{ color: 'var(--text-muted)' }}>Search a bill, review eligible items, and save the return.</p>
                    </div>
                    <button className="btn btn-primary" onClick={saveReturn} disabled={saving || !selectedBill}>
                        <Save size={14} /> {saving ? 'Saving...' : 'Save Return'}
                    </button>
                </div>
                <ModuleTabs tabs={salesTabs} />
            </div>

            <div className="surface" style={{ padding: '1rem', display: 'grid', gap: '1rem' }}>
                <div className="form-group">
                    <label className="form-label">Search Bills</label>
                    <div style={{ position: 'relative' }}>
                        <Search size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                        <input
                            ref={searchInputRef}
                            value={billSearch}
                            onChange={(event) => setBillSearch(event.target.value)}
                            placeholder="Search by bill number, customer name, phone, or date"
                            style={{ paddingLeft: '2rem' }}
                        />
                    </div>
                </div>

                <div className="surface" style={{ padding: '0.85rem', background: 'var(--bg-elevated)' }}>
                    {filteredBills.length === 0 ? (
                        <div className="empty-state" style={{ minHeight: 150 }}>
                            <ReceiptText size={34} />
                            <span>No bill selected</span>
                            <span style={{ color: 'var(--text-muted)' }}>Search or select a bill to start a return.</span>
                            <button className="btn btn-primary btn-sm" onClick={() => searchInputRef.current?.focus()}>Search Bills</button>
                        </div>
                    ) : (
                        <div style={{ display: 'grid', gap: '0.45rem' }}>
                            {filteredBills.map((bill) => (
                                <button
                                    key={bill.id}
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => handleBillSelect(String(bill.id))}
                                    style={{
                                        justifyContent: 'space-between',
                                        background: Number(selectedBillId) === bill.id ? 'var(--accent-light)' : 'var(--bg-surface)',
                                        border: '1px solid var(--border)',
                                        padding: '0.85rem 1rem',
                                    }}
                                >
                                    <span style={{ textAlign: 'left' }}>
                                        {bill.bill_number} · {getBillCustomerLabel(bill)}
                                        {bill.customer?.phone ? ` · ${bill.customer.phone}` : ''}
                                    </span>
                                    <span style={{ color: 'var(--text-muted)' }}>{new Date(bill.bill_date).toLocaleDateString('en-IN')}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 2fr) repeat(3, minmax(160px, 1fr))', gap: '1rem' }}>
                    <div className="form-group">
                        <label className="form-label">Bill</label>
                        <select value={selectedBillId} onChange={(event) => handleBillSelect(event.target.value)}>
                            <option value="">Select bill</option>
                            {bills.map((bill) => (
                                <option key={bill.id} value={bill.id}>
                                    {bill.bill_number} · {new Date(bill.bill_date).toLocaleDateString('en-IN')} · {formatCurrency(bill.grand_total)}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="form-group">
                        <label className="form-label">Return Date</label>
                        <input type="date" value={returnDate} onChange={(event) => setReturnDate(event.target.value)} />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Settlement</label>
                        <select value={settlementType} onChange={(event) => setSettlementType(event.target.value)}>
                            <option value="Cash Refund">Cash Refund</option>
                            <option value="UPI Refund">UPI Refund</option>
                            <option value="Adjust Against Due">Adjust Against Due</option>
                            <option value="Customer Credit / Store Credit">Customer Credit / Store Credit</option>
                            <option value="No Refund">No Refund</option>
                        </select>
                    </div>
                    <div className="form-group">
                        <label className="form-label">Customer</label>
                        <input value={selectedBill ? getBillCustomerLabel(selectedBill) : 'Select a bill first'} readOnly />
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '1rem' }}>
                    <div className="form-group">
                        <label className="form-label">Return Reason</label>
                        <textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Customer return reason, correction note, quality issue..." />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Notes</label>
                        <textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional internal note" />
                    </div>
                </div>

                {!selectedBill ? (
                    <div className="empty-state" style={{ minHeight: 180 }}>
                        <ReceiptText size={34} />
                        <span>No bill selected</span>
                        <span style={{ color: 'var(--text-muted)' }}>Search or select a bill to start a return.</span>
                        <button className="btn btn-primary btn-sm" onClick={() => searchInputRef.current?.focus()}>Search Bills</button>
                    </div>
                ) : (
                    <>
                        <div className="surface" style={{ padding: '1rem', background: 'var(--bg-elevated)' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.85rem' }}>
                                <div>
                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Bill</p>
                                    <strong>{selectedBill.bill_number}</strong>
                                </div>
                                <div>
                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Customer</p>
                                    <strong>{getBillCustomerLabel(selectedBill)}</strong>
                                </div>
                                <div>
                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Phone</p>
                                    <strong>{selectedBill.customer?.phone || '—'}</strong>
                                </div>
                                <div>
                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Bill Total</p>
                                    <strong>{formatCurrency(selectedBill.grand_total)}</strong>
                                </div>
                            </div>
                        </div>

                        <div className="surface" style={{ overflow: 'hidden' }}>
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Item</th>
                                        <th style={{ textAlign: 'right' }}>Sold</th>
                                        <th style={{ textAlign: 'right' }}>Returned</th>
                                        <th style={{ textAlign: 'right' }}>Remaining</th>
                                        <th style={{ textAlign: 'right' }}>Qty to Return</th>
                                        <th style={{ textAlign: 'right' }}>Amount</th>
                                        <th>Stock Action</th>
                                        <th>Item Reason</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(selectedBill.sales_items || []).map((item) => {
                                        const row = itemForms[item.id] || {};
                                        const returned = returnedQuantities[item.id] || 0;
                                        const remaining = Math.max(0, Number(item.quantity || 0) - returned);
                                        return (
                                            <tr key={item.id}>
                                                <td>{item.product_name_snapshot || item.product?.product_name || `Item #${item.id}`}</td>
                                                <td style={{ textAlign: 'right' }}>{item.quantity}</td>
                                                <td style={{ textAlign: 'right' }}>{returned}</td>
                                                <td style={{ textAlign: 'right', fontWeight: 700 }}>{remaining}</td>
                                                <td style={{ textAlign: 'right' }}>
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        max={remaining}
                                                        value={row.quantity || ''}
                                                        onChange={(event) => updateItemForm(item.id, { quantity: event.target.value })}
                                                        style={{ width: 90, marginLeft: 'auto' }}
                                                    />
                                                </td>
                                                <td style={{ textAlign: 'right' }}>
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        step={0.01}
                                                        value={row.amount || ''}
                                                        onChange={(event) => updateItemForm(item.id, { amount: event.target.value })}
                                                        style={{ width: 120, marginLeft: 'auto' }}
                                                    />
                                                </td>
                                                <td>
                                                    <select value={row.stock_action || 'SELLABLE'} onChange={(event) => updateItemForm(item.id, { stock_action: event.target.value })}>
                                                        <option value="SELLABLE">Sellable</option>
                                                        <option value="DAMAGED">Damaged</option>
                                                        <option value="NON_SELLABLE">Non-sellable</option>
                                                    </select>
                                                </td>
                                                <td>
                                                    <input value={row.reason || ''} onChange={(event) => updateItemForm(item.id, { reason: event.target.value })} placeholder="Optional line reason" />
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}

                <div className="surface" style={{ overflow: 'hidden' }}>
                    {loading ? (
                        <div style={{ padding: '1.2rem' }}>
                            {[...Array(5)].map((_, index) => <div key={index} className="skeleton" style={{ height: 40, marginBottom: 8 }} />)}
                        </div>
                    ) : salesReturns.length === 0 ? (
                        <div className="empty-state" style={{ minHeight: 170 }}>
                            <ReceiptText size={34} />
                            <span>No sales returns yet</span>
                            <span style={{ color: 'var(--text-muted)' }}>Returns created against bills will appear here.</span>
                        </div>
                    ) : (
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Return No.</th>
                                    <th>Date</th>
                                    <th>Bill</th>
                                    <th>Settlement</th>
                                    <th>Status</th>
                                    <th style={{ textAlign: 'right' }}>Amount</th>
                                </tr>
                            </thead>
                            <tbody>
                                {salesReturns.map((entry) => (
                                    <tr key={entry.id}>
                                        <td style={{ fontWeight: 600 }}>{entry.return_number || `SR-${entry.id}`}</td>
                                        <td>{new Date(entry.return_date).toLocaleDateString('en-IN')}</td>
                                        <td>{entry.bill_id ? `Bill #${entry.bill_id}` : '—'}</td>
                                        <td>{entry.settlement_type}</td>
                                        <td>{entry.status}</td>
                                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCurrency(entry.total_amount)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
}
