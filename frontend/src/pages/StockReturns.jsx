import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AlertTriangle, PackageX, Save, Truck } from 'lucide-react';
import {
    adjustStock,
    createStockReturn,
    getProducts,
    getStockAdjustments,
    getStockBatchesForProduct,
    getStockReturns,
    getSuppliers,
    updateStockReturn,
} from '../api';
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

function emptyReturnItem() {
    return {
        product_id: '',
        stock_batch_id: '',
        stock_source: 'SELLABLE',
        quantity: '',
        amount: '',
        reason: '',
    };
}

const returnTabs = [
    { label: 'Supplier Stock Returns', path: '/stock-returns', end: true },
    { label: 'Supplier Credit Notes', path: '/credit-notes' },
    { label: 'Damage / Expiry', path: '/stock-adjustments' },
    { label: 'Return History', path: '/returns-history' },
];

export default function StockReturns() {
    const { addToast } = useToast();
    const location = useLocation();
    const [tab, setTab] = useState('returns');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [suppliers, setSuppliers] = useState([]);
    const [products, setProducts] = useState([]);
    const [stockReturns, setStockReturns] = useState([]);
    const [stockAdjustments, setStockAdjustments] = useState([]);
    const [batchOptions, setBatchOptions] = useState({});
    const [returnForm, setReturnForm] = useState({
        supplier_id: '',
        return_date: getToday(),
        status: 'Pending',
        credit_amount: '',
        reason: '',
        notes: '',
        items: [emptyReturnItem()],
    });
    const [adjustmentForm, setAdjustmentForm] = useState({
        product_id: '',
        stock_batch_id: '',
        adjustment_type: 'DAMAGE',
        quantity: '',
        reason: '',
        final_action: 'Adjusted',
    });
    const [adjustmentBatches, setAdjustmentBatches] = useState([]);

    const load = async () => {
        setLoading(true);
        try {
            const [suppliersResponse, productsResponse, returnsResponse, adjustmentsResponse] = await Promise.all([
                getSuppliers(),
                getProducts(),
                getStockReturns(),
                getStockAdjustments(),
            ]);
            setSuppliers(suppliersResponse.data);
            setProducts(productsResponse.data);
            setStockReturns(returnsResponse.data);
            setStockAdjustments(adjustmentsResponse.data);
        } catch (error) {
            addToast(getApiErrorMessage(error, 'Failed to load stock workflow data'), 'error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
    }, []);

    useEffect(() => {
        if (location.pathname === '/stock-adjustments') {
            setTab('damage');
        } else if (location.pathname === '/returns-history') {
            setTab('history');
        } else {
            setTab('returns');
        }
    }, [location.pathname]);

    const loadBatchesForItem = async (productId, itemIndex) => {
        if (!productId) {
            setBatchOptions((current) => ({ ...current, [itemIndex]: [] }));
            return;
        }
        try {
            const response = await getStockBatchesForProduct(productId);
            setBatchOptions((current) => ({ ...current, [itemIndex]: response.data }));
        } catch (error) {
            addToast(getApiErrorMessage(error, 'Failed to load product batches'), 'error');
        }
    };

    const loadAdjustmentBatches = async (productId) => {
        if (!productId) {
            setAdjustmentBatches([]);
            return;
        }
        try {
            const response = await getStockBatchesForProduct(productId);
            setAdjustmentBatches(response.data);
        } catch (error) {
            addToast(getApiErrorMessage(error, 'Failed to load product batches'), 'error');
        }
    };

    const updateReturnItem = (index, patch) => {
        setReturnForm((current) => ({
            ...current,
            items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
        }));
    };

    const addReturnItem = () => {
        setReturnForm((current) => ({ ...current, items: [...current.items, emptyReturnItem()] }));
    };

    const removeReturnItem = (index) => {
        setReturnForm((current) => ({
            ...current,
            items: current.items.length === 1 ? current.items : current.items.filter((_, itemIndex) => itemIndex !== index),
        }));
    };

    const saveStockReturn = async () => {
        if (!returnForm.supplier_id) {
            addToast('Select a supplier for the stock return.', 'error');
            return;
        }
        if (!returnForm.reason.trim()) {
            addToast('Reason is required.', 'error');
            return;
        }

        const items = returnForm.items
            .map((item) => ({
                ...item,
                product_id: item.product_id ? Number(item.product_id) : null,
                stock_batch_id: item.stock_batch_id ? Number(item.stock_batch_id) : null,
                quantity: Number(item.quantity) || 0,
                amount: Number(item.amount) || 0,
                reason: item.reason?.trim() || returnForm.reason.trim(),
            }))
            .filter((item) => item.product_id && item.quantity > 0);

        if (items.length === 0) {
            addToast('Add at least one valid stock return item.', 'error');
            return;
        }

        setSaving(true);
        try {
            await createStockReturn({
                supplier_id: Number(returnForm.supplier_id),
                return_date: returnForm.return_date,
                status: returnForm.status,
                credit_amount: Number(returnForm.credit_amount) || 0,
                reason: returnForm.reason.trim(),
                notes: returnForm.notes.trim() || null,
                items,
            });
            addToast('Stock return saved.', 'success');
            setReturnForm({
                supplier_id: '',
                return_date: getToday(),
                status: 'Pending',
                credit_amount: '',
                reason: '',
                notes: '',
                items: [emptyReturnItem()],
            });
            setBatchOptions({});
            await load();
        } catch (error) {
            addToast(getApiErrorMessage(error, 'Failed to save stock return'), 'error');
        } finally {
            setSaving(false);
        }
    };

    const saveStockAdjustment = async () => {
        if (!adjustmentForm.product_id || !adjustmentForm.stock_batch_id) {
            addToast('Select a product and batch for the adjustment.', 'error');
            return;
        }
        if (!adjustmentForm.reason.trim()) {
            addToast('Reason is required.', 'error');
            return;
        }
        if (!adjustmentForm.quantity || Number(adjustmentForm.quantity) <= 0) {
            addToast('Enter a valid adjustment quantity.', 'error');
            return;
        }

        setSaving(true);
        try {
            await adjustStock({
                product_id: Number(adjustmentForm.product_id),
                stock_batch_id: Number(adjustmentForm.stock_batch_id),
                adjustment_type: adjustmentForm.adjustment_type,
                quantity: Number(adjustmentForm.quantity),
                reason: adjustmentForm.reason.trim(),
                final_action: adjustmentForm.final_action,
            });
            addToast('Non-sellable stock adjustment saved.', 'success');
            setAdjustmentForm({
                product_id: '',
                stock_batch_id: '',
                adjustment_type: 'DAMAGE',
                quantity: '',
                reason: '',
                final_action: 'Adjusted',
            });
            setAdjustmentBatches([]);
            await load();
        } catch (error) {
            addToast(getApiErrorMessage(error, 'Failed to save stock adjustment'), 'error');
        } finally {
            setSaving(false);
        }
    };

    const updateReturnStatus = async (returnId, status) => {
        const currentReturn = stockReturns.find((entry) => entry.id === returnId);
        if (!currentReturn) return;
        try {
            await updateStockReturn(returnId, {
                status,
                credit_amount: currentReturn.credit_amount || 0,
                notes: currentReturn.notes || '',
            });
            addToast('Stock return status updated.', 'success');
            await load();
        } catch (error) {
            addToast(getApiErrorMessage(error, 'Failed to update stock return status'), 'error');
        }
    };

    return (
        <div style={{ display: 'grid', gap: '1rem' }}>
            <div>
                <div className="page-header">
                    <div>
                        <h2 style={{ fontSize: '1.15rem', marginBottom: '0.2rem' }}>
                            {tab === 'damage' ? 'Damage / Expiry' : tab === 'history' ? 'Return History' : 'Supplier Stock Returns'}
                        </h2>
                    </div>
                </div>
                <ModuleTabs tabs={returnTabs} />
            </div>

            {tab === 'returns' ? (
                <>
                    <div className="surface" style={{ padding: '1rem', display: 'grid', gap: '1rem' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 2fr) repeat(3, minmax(160px, 1fr))', gap: '1rem' }}>
                            <div className="form-group">
                                <label className="form-label">Supplier</label>
                                <select value={returnForm.supplier_id} onChange={(event) => setReturnForm((current) => ({ ...current, supplier_id: event.target.value }))}>
                                    <option value="">Select supplier</option>
                                    {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.company_name}</option>)}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Return Date</label>
                                <input type="date" value={returnForm.return_date} onChange={(event) => setReturnForm((current) => ({ ...current, return_date: event.target.value }))} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Status</label>
                                <select value={returnForm.status} onChange={(event) => setReturnForm((current) => ({ ...current, status: event.target.value }))}>
                                    <option value="Pending">Pending</option>
                                    <option value="Sent">Sent</option>
                                    <option value="Accepted">Accepted</option>
                                    <option value="Rejected">Rejected</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Credit Amount</label>
                                <input type="number" min={0} step={0.01} value={returnForm.credit_amount} onChange={(event) => setReturnForm((current) => ({ ...current, credit_amount: event.target.value }))} />
                            </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '1rem' }}>
                            <div className="form-group">
                                <label className="form-label">Reason</label>
                                <textarea rows={3} value={returnForm.reason} onChange={(event) => setReturnForm((current) => ({ ...current, reason: event.target.value }))} placeholder="Damage, expiry, wrong item, excess stock..." />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Notes</label>
                                <textarea rows={3} value={returnForm.notes} onChange={(event) => setReturnForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Optional internal note" />
                            </div>
                        </div>

                        <div style={{ display: 'grid', gap: '0.9rem' }}>
                            {returnForm.items.map((item, index) => (
                                <div key={index} style={{ border: '1px solid var(--border)', borderRadius: 14, padding: '1rem', background: 'var(--bg-elevated)', display: 'grid', gap: '0.9rem' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                        <p style={{ fontWeight: 700 }}>Return Item {index + 1}</p>
                                        <button className="btn btn-ghost btn-sm" onClick={() => removeReturnItem(index)} disabled={returnForm.items.length === 1}>Remove</button>
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 1.5fr) minmax(220px, 1fr)', gap: '1rem' }}>
                                        <div className="form-group">
                                            <label className="form-label">Product</label>
                                            <select
                                                value={item.product_id}
                                                onChange={(event) => {
                                                    const productId = event.target.value;
                                                    updateReturnItem(index, { product_id: productId, stock_batch_id: '' });
                                                    loadBatchesForItem(productId, index);
                                                }}
                                            >
                                                <option value="">Select product</option>
                                                {products.map((product) => (
                                                    <option key={product.id} value={product.id}>
                                                        {[product.brand_name, product.product_name].filter(Boolean).join(' ')}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Batch</label>
                                            <select value={item.stock_batch_id} onChange={(event) => updateReturnItem(index, { stock_batch_id: event.target.value })}>
                                                <option value="">Select batch</option>
                                                {(batchOptions[index] || []).map((batch) => (
                                                    <option key={batch.id} value={batch.id}>
                                                        {(batch.batch_number || `Batch #${batch.id}`)} · Sellable {batch.available_quantity} · Non-sellable {batch.non_sellable_quantity || 0}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(160px, 1fr))', gap: '1rem' }}>
                                        <div className="form-group">
                                            <label className="form-label">Source</label>
                                            <select value={item.stock_source} onChange={(event) => updateReturnItem(index, { stock_source: event.target.value })}>
                                                <option value="SELLABLE">Sellable</option>
                                                <option value="NON_SELLABLE">Non-sellable</option>
                                            </select>
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Qty</label>
                                            <input type="number" min={0} value={item.quantity} onChange={(event) => updateReturnItem(index, { quantity: event.target.value })} />
                                        </div>
                                        <div className="form-group">
                                            <label className="form-label">Amount</label>
                                            <input type="number" min={0} step={0.01} value={item.amount} onChange={(event) => updateReturnItem(index, { amount: event.target.value })} />
                                        </div>
                                    </div>

                                    <div className="form-group">
                                        <label className="form-label">Item Reason</label>
                                        <input value={item.reason} onChange={(event) => updateReturnItem(index, { reason: event.target.value })} placeholder="Optional line reason" />
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                            <button className="btn btn-ghost btn-sm" onClick={addReturnItem}><PackageX size={14} /> Add Item</button>
                            <button className="btn btn-primary" onClick={saveStockReturn} disabled={saving}>
                                <Save size={14} /> {saving ? 'Saving...' : 'Save Stock Return'}
                            </button>
                        </div>

                        <div className="surface" style={{ padding: '0.9rem', background: 'var(--bg-elevated)' }}>
                            <p style={{ fontWeight: 700, marginBottom: '0.75rem' }}>Added Return Items</p>
                            {returnForm.items.every((item) => !item.product_id && !item.quantity && !item.amount && !item.reason) ? (
                                <div className="empty-state" style={{ minHeight: 120 }}><PackageX size={30} /><span>No items added yet</span></div>
                            ) : (
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Product</th>
                                            <th>Batch</th>
                                            <th>Source</th>
                                            <th style={{ textAlign: 'right' }}>Qty</th>
                                            <th style={{ textAlign: 'right' }}>Amount</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {returnForm.items.map((item, index) => {
                                            const product = products.find((entry) => String(entry.id) === String(item.product_id));
                                            const batch = (batchOptions[index] || []).find((entry) => String(entry.id) === String(item.stock_batch_id));
                                            return (
                                                <tr key={`summary-${index}`}>
                                                    <td>{product ? [product.brand_name, product.product_name].filter(Boolean).join(' ') : '—'}</td>
                                                    <td>{batch ? (batch.batch_number || `Batch #${batch.id}`) : '—'}</td>
                                                    <td>{item.stock_source === 'NON_SELLABLE' ? 'Non-sellable' : 'Sellable'}</td>
                                                    <td style={{ textAlign: 'right' }}>{item.quantity || '—'}</td>
                                                    <td style={{ textAlign: 'right' }}>{item.amount ? formatCurrency(item.amount) : '—'}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>

                    <div className="surface" style={{ overflow: 'hidden' }}>
                        {loading ? (
                            <div style={{ padding: '1.2rem' }}>
                                {[...Array(6)].map((_, index) => <div key={index} className="skeleton" style={{ height: 40, marginBottom: 8 }} />)}
                            </div>
                        ) : stockReturns.length === 0 ? (
                            <div className="empty-state"><Truck size={34} /><span>No supplier stock returns yet</span></div>
                        ) : (
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Return No.</th>
                                        <th>Date</th>
                                        <th>Supplier</th>
                                        <th>Status</th>
                                        <th>Reason</th>
                                        <th style={{ textAlign: 'right' }}>Credit</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {stockReturns.map((entry) => (
                                        <tr key={entry.id}>
                                            <td style={{ fontWeight: 600 }}>{entry.return_number || `STR-${entry.id}`}</td>
                                            <td>{new Date(entry.return_date).toLocaleDateString('en-IN')}</td>
                                            <td>{suppliers.find((supplier) => supplier.id === entry.supplier_id)?.company_name || `Supplier #${entry.supplier_id}`}</td>
                                            <td>
                                                <select value={entry.status} onChange={(event) => updateReturnStatus(entry.id, event.target.value)}>
                                                    <option value="Pending">Pending</option>
                                                    <option value="Sent">Sent</option>
                                                    <option value="Accepted">Accepted</option>
                                                    <option value="Rejected">Rejected</option>
                                                </select>
                                            </td>
                                            <td>{entry.reason}</td>
                                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCurrency(entry.credit_amount)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </>
            ) : tab === 'damage' ? (
                <>
                    <div className="surface" style={{ padding: '1rem', display: 'grid', gap: '1rem' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(180px, 1fr))', gap: '1rem' }}>
                            <div className="form-group">
                                <label className="form-label">Product</label>
                                <select
                                    value={adjustmentForm.product_id}
                                    onChange={(event) => {
                                        const productId = event.target.value;
                                        setAdjustmentForm((current) => ({ ...current, product_id: productId, stock_batch_id: '' }));
                                        loadAdjustmentBatches(productId);
                                    }}
                                >
                                    <option value="">Select product</option>
                                    {products.map((product) => (
                                        <option key={product.id} value={product.id}>
                                            {[product.brand_name, product.product_name].filter(Boolean).join(' ')}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Batch</label>
                                <select value={adjustmentForm.stock_batch_id} onChange={(event) => setAdjustmentForm((current) => ({ ...current, stock_batch_id: event.target.value }))}>
                                    <option value="">Select batch</option>
                                    {adjustmentBatches.map((batch) => (
                                        <option key={batch.id} value={batch.id}>
                                            {(batch.batch_number || `Batch #${batch.id}`)} · Sellable {batch.available_quantity}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Adjustment Type</label>
                                <select value={adjustmentForm.adjustment_type} onChange={(event) => setAdjustmentForm((current) => ({ ...current, adjustment_type: event.target.value }))}>
                                    <option value="DAMAGE">Damage</option>
                                    <option value="EXPIRY">Expiry</option>
                                    <option value="BROKEN">Broken</option>
                                    <option value="LEAKED">Leaked</option>
                                    <option value="NON_SELLABLE">Non-sellable</option>
                                </select>
                            </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(180px, 1fr))', gap: '1rem' }}>
                            <div className="form-group">
                                <label className="form-label">Quantity</label>
                                <input type="number" min={0} value={adjustmentForm.quantity} onChange={(event) => setAdjustmentForm((current) => ({ ...current, quantity: event.target.value }))} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Final Action</label>
                                <select value={adjustmentForm.final_action} onChange={(event) => setAdjustmentForm((current) => ({ ...current, final_action: event.target.value }))}>
                                    <option value="Adjusted">Adjusted</option>
                                    <option value="Destroyed">Destroyed</option>
                                    <option value="Returned to Supplier">Returned to Supplier</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Reason</label>
                                <input value={adjustmentForm.reason} onChange={(event) => setAdjustmentForm((current) => ({ ...current, reason: event.target.value }))} placeholder="Reason for non-sellable stock" />
                            </div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <button className="btn btn-primary" onClick={saveStockAdjustment} disabled={saving}>
                                <Save size={14} /> {saving ? 'Saving...' : 'Save Adjustment'}
                            </button>
                        </div>
                    </div>

                    <div className="surface" style={{ overflow: 'hidden' }}>
                        {loading ? (
                            <div style={{ padding: '1.2rem' }}>
                                {[...Array(6)].map((_, index) => <div key={index} className="skeleton" style={{ height: 40, marginBottom: 8 }} />)}
                            </div>
                        ) : stockAdjustments.length === 0 ? (
                            <div className="empty-state"><AlertTriangle size={34} /><span>No damage or expiry adjustments yet</span></div>
                        ) : (
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Date</th>
                                        <th>Product</th>
                                        <th>Type</th>
                                        <th>Reason</th>
                                        <th>Final Action</th>
                                        <th style={{ textAlign: 'right' }}>Qty</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {stockAdjustments.map((entry) => (
                                        <tr key={entry.id}>
                                            <td>{new Date(entry.created_at).toLocaleDateString('en-IN')}</td>
                                            <td>{products.find((product) => product.id === entry.product_id)?.product_name || `Product #${entry.product_id}`}</td>
                                            <td>{entry.adjustment_type}</td>
                                            <td>{entry.reason || '—'}</td>
                                            <td>{entry.final_action || 'Adjusted'}</td>
                                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{entry.quantity}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </>
            ) : (
                <div className="entry-layout" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
                    <div className="surface" style={{ overflow: 'hidden' }}>
                        <div style={{ padding: '1rem', borderBottom: '1px solid var(--border)' }}>
                            <p style={{ fontWeight: 700 }}>Supplier Return History</p>
                        </div>
                        {stockReturns.length === 0 ? (
                            <div className="empty-state" style={{ minHeight: 180 }}><Truck size={34} /><span>No supplier stock returns yet</span></div>
                        ) : (
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Return No.</th>
                                        <th>Date</th>
                                        <th>Status</th>
                                        <th>Reason</th>
                                        <th style={{ textAlign: 'right' }}>Credit</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {stockReturns.map((entry) => (
                                        <tr key={`history-${entry.id}`}>
                                            <td style={{ fontWeight: 600 }}>{entry.return_number || `STR-${entry.id}`}</td>
                                            <td>{new Date(entry.return_date).toLocaleDateString('en-IN')}</td>
                                            <td><span className="badge badge-muted">{entry.status}</span></td>
                                            <td>{entry.reason}</td>
                                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatCurrency(entry.credit_amount)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                    <div className="surface" style={{ overflow: 'hidden' }}>
                        <div style={{ padding: '1rem', borderBottom: '1px solid var(--border)' }}>
                            <p style={{ fontWeight: 700 }}>Damage / Expiry History</p>
                        </div>
                        {stockAdjustments.length === 0 ? (
                            <div className="empty-state" style={{ minHeight: 180 }}><AlertTriangle size={34} /><span>No damage or expiry entries yet</span></div>
                        ) : (
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Product</th>
                                        <th>Type</th>
                                        <th>Qty</th>
                                        <th>Final Action</th>
                                        <th>Date</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {stockAdjustments.map((entry) => (
                                        <tr key={`adjustment-${entry.id}`}>
                                            <td>{products.find((product) => product.id === entry.product_id)?.product_name || `Product #${entry.product_id}`}</td>
                                            <td>{entry.adjustment_type}</td>
                                            <td>{entry.quantity}</td>
                                            <td>{entry.final_action || 'Adjusted'}</td>
                                            <td>{new Date(entry.created_at).toLocaleDateString('en-IN')}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
