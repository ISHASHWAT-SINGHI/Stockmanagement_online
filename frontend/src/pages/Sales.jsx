import { useEffect, useState, useCallback, useRef } from 'react';
import { Plus, Trash2, ShoppingCart, Save, CheckCircle, Eye, Printer } from 'lucide-react';
import { getProducts, getCustomers, getStockBatchesForProduct, createSale, getSales, getSale, getBusinessSettings } from '../api';
import { useKeyboardShortcut } from '../hooks/useKeyboard';
import { useToast } from '../hooks/useToast';
import Modal from '../components/Modal';

const GST_RATES = [0, 5, 12, 18, 28];

function emptyItem() {
    return { product_id: '', stock_batch_id: '', product_name: '', quantity: 1, selling_price: 0, gst_percent: 12, discount_percent: 0, final_amount: 0, available: 0 };
}

function normalizeText(value = '') {
    return value.toLowerCase().trim().replace(/\s+/g, ' ');
}

function getProductDisplayName(product) {
    return [product.brand_name, product.product_name].filter(Boolean).join(' ');
}

function getSaleItemDisplayName(item) {
    if (item?.product) {
        return getProductDisplayName(item.product);
    }
    return item?.product_id ? `Product #${item.product_id}` : 'Unknown Product';
}

function matchesProductSearch(product, rawQuery) {
    const query = normalizeText(rawQuery);
    if (!query) return false;
    return [
        normalizeText(product.product_name),
        normalizeText(product.brand_name || ''),
        normalizeText(getProductDisplayName(product)),
    ].some(value => value.includes(query));
}

function findExactProductMatch(products, rawQuery) {
    const query = normalizeText(rawQuery);
    if (!query) return null;
    const matches = products.filter(product => [
        normalizeText(product.product_name),
        normalizeText(product.brand_name || ''),
        normalizeText(getProductDisplayName(product)),
    ].includes(query));
    return matches.length === 1 ? matches[0] : null;
}

function calcItem(it) {
    const base = it.selling_price * it.quantity;
    const afterDiscount = base - (base * it.discount_percent / 100);
    const gstAmt = afterDiscount * it.gst_percent / 100;
    return { ...it, final_amount: +(afterDiscount + gstAmt).toFixed(2) };
}

function calcBill(items, discountAmt, isDiscountPercent) {
    const subtotal = items.reduce((s, i) => s + (i.selling_price * i.quantity), 0);
    const taxable = items.reduce((s, i) => s + i.selling_price * i.quantity * (1 - i.discount_percent / 100), 0);
    const gstTotal = items.reduce((s, i) => s + i.selling_price * i.quantity * (1 - i.discount_percent / 100) * i.gst_percent / 100, 0);
    
    // Apply extra discount
    const extraDiscountValue = isDiscountPercent ? (taxable + gstTotal) * (discountAmt / 100) : discountAmt;
    const grandExact = taxable + gstTotal - (extraDiscountValue || 0);
    const grandRounded = Math.round(grandExact);
    
    return { 
        subtotal: +subtotal.toFixed(2), 
        taxable: +taxable.toFixed(2), 
        cgst: +(gstTotal / 2).toFixed(2), 
        sgst: +(gstTotal / 2).toFixed(2), 
        grandExact: +grandExact.toFixed(2),
        grand: grandRounded,
        extraDiscountValue: +extraDiscountValue.toFixed(2)
    };
}

function getTodayInputValue() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export default function Sales() {
    const { addToast } = useToast();
    const [products, setProducts] = useState([]);
    const [customers, setCustomers] = useState([]);
    const [bills, setBills] = useState([]);
    const [view, setView] = useState('new'); 

    // Bill form state
    const [customerId, setCustomerId] = useState('');
    const [customerSearch, setCustomerSearch] = useState('');
    const [billDate, setBillDate] = useState(getTodayInputValue());
    const [items, setItems] = useState([emptyItem()]);
    
    const [discountAmt, setDiscountAmt] = useState(0);
    const [isDiscountPercent, setIsDiscountPercent] = useState(false);
    
    const [paymentMode, setPaymentMode] = useState('Cash');
    const [paidAmt, setPaidAmt] = useState('');
    const [saving, setSaving] = useState(false);
    
    const [productSuggestions, setProductSuggestions] = useState({ index: null, list: [], activeIdx: -1 });
    const [customerSuggestions, setCustomerSuggestions] = useState([]);
    const [customerSuggestIndex, setCustomerSuggestIndex] = useState(-1);
    
    const [selectedBill, setSelectedBill] = useState(null);
    const [settings, setSettings] = useState(null);
    const itemRefs = useRef([]);
    const productInputRefs = useRef([]);

    const load = useCallback(async () => {
        try {
            const [pRes, cRes, sRes, setRes] = await Promise.all([getProducts(), getCustomers(), getSales(), getBusinessSettings()]);
            setProducts(pRes.data);
            setCustomers(cRes.data);
            setBills([...sRes.data].reverse());
            setSettings(setRes.data);
        } catch { addToast('Failed to load data', 'error'); }
    }, [addToast]);

    useEffect(() => { load(); }, [load]);

    // Alt+N → add new item row
    useKeyboardShortcut('n', () => addRow(true), { alt: true, allowInInput: true });

    const focusProductInputAt = (index) => {
        window.setTimeout(() => productInputRefs.current[index]?.focus(), 0);
    };

    const addRow = (focusProduct = false) => {
        const nextIndex = items.length;
        setItems(prev => [...prev, emptyItem()]);
        if (focusProduct) focusProductInputAt(nextIndex);
    };

    const removeRow = (i) => setItems(prev => prev.filter((_, idx) => idx !== i));

    const updateItem = (i, field, val) => {
        setItems(prev => {
            const next = [...prev];
            next[i] = calcItem({ ...next[i], [field]: val });
            return next;
        });
    };

    // Product search → suggestions
    const handleProductSearch = (i, val) => {
        updateItem(i, 'product_name', val);
        updateItem(i, 'product_id', '');
        if (val.length < 2) { setProductSuggestions({ index: null, list: [], activeIdx: -1 }); return; }
        const list = products.filter(p => matchesProductSearch(p, val)).slice(0, 8);
        setProductSuggestions({ index: i, list, activeIdx: -1 });
    };

    const applyProductSelection = async (i, product, focusQuantity = true) => {
        setProductSuggestions({ index: null, list: [], activeIdx: -1 });
        let batchId = '';
        let available = 0;
        try {
            const r = await getStockBatchesForProduct(product.id);
            if (r.data.length > 0) { batchId = r.data[0].id; available = r.data[0].available_quantity; }
        } catch { /* no batches */ }
        setItems(prev => {
            const next = [...prev];
            next[i] = calcItem({ ...next[i], product_id: product.id, stock_batch_id: batchId, product_name: getProductDisplayName(product), available });
            return next;
        });
        if (focusQuantity) {
            window.setTimeout(() => itemRefs.current[i]?.focus(), 50);
        }
    };

    const selectProduct = async (i, product) => {
        await applyProductSelection(i, product, true);
    };

    const commitProductMatch = async (i, rawValue) => {
        const exactMatch = findExactProductMatch(products, rawValue);
        if (exactMatch) {
            await applyProductSelection(i, exactMatch, false);
        } else if (productSuggestions.index === i) {
            setProductSuggestions({ index: null, list: [], activeIdx: -1 });
        }
    };

    const onProductKeyDown = (e, i) => {
        const { list, activeIdx } = productSuggestions;
        if (productSuggestions.index !== i || list.length === 0) return;
        
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setProductSuggestions(s => ({ ...s, activeIdx: Math.min(s.activeIdx + 1, list.length - 1) }));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setProductSuggestions(s => ({ ...s, activeIdx: Math.max(s.activeIdx - 1, -1) }));
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            if (activeIdx >= 0 && activeIdx < list.length) {
                e.preventDefault();
                selectProduct(i, list[activeIdx]);
            } else if (list.length > 0) {
                e.preventDefault();
                selectProduct(i, list[0]); 
            }
        } else if (e.key === 'Escape') {
            setProductSuggestions({ index: null, list: [], activeIdx: -1 });
        }
    };

    // Customer search
    const handleCustomerSearch = (val) => {
        setCustomerSearch(val);
        setCustomerId('');
        setCustomerSuggestIndex(-1);
        if (!val) { setCustomerSuggestions([]); return; }
        setCustomerSuggestions(customers.filter(c =>
            c.name.toLowerCase().includes(val.toLowerCase()) || (c.phone || '').includes(val)
        ).slice(0, 6));
    };

    const selectCustomer = (c) => {
        setCustomerId(c.id);
        setCustomerSearch(c.name + (c.phone ? ` (${c.phone})` : ''));
        setCustomerSuggestions([]);
    };
    
    const onCustomerKeyDown = (e) => {
        if (customerSuggestions.length === 0) return;
        
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setCustomerSuggestIndex(i => Math.min(i + 1, customerSuggestions.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setCustomerSuggestIndex(i => Math.max(i - 1, -1));
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            if (customerSuggestIndex >= 0 && customerSuggestIndex < customerSuggestions.length) {
                e.preventDefault();
                selectCustomer(customerSuggestions[customerSuggestIndex]);
            } else if (e.key === 'Tab' && customerSuggestions.length > 0) {
                e.preventDefault();
                selectCustomer(customerSuggestions[0]);
            }
        } else if (e.key === 'Escape') {
            setCustomerSuggestions([]);
        }
    };

    const openDetails = async (id) => {
        try {
            const res = await getSale(id);
            setSelectedBill(res.data);
        } catch { addToast('Failed to load details', 'error'); }
    };

    const totals = calcBill(items.filter(i => i.product_id), discountAmt, isDiscountPercent);
    const nextBillNo = `BILL-${Date.now().toString().slice(-6)}`;
    const resolveItemsForSave = async () => {
        const resolved = await Promise.all(items.map(async (item) => {
            if (item.product_id || !item.product_name?.trim()) return item;
            const exactMatch = findExactProductMatch(products, item.product_name);
            if (!exactMatch) return item;

            let batchId = '';
            let available = 0;
            try {
                const response = await getStockBatchesForProduct(exactMatch.id);
                if (response.data.length > 0) {
                    batchId = response.data[0].id;
                    available = response.data[0].available_quantity;
                }
            } catch { /* keep unresolved */ }

            return calcItem({
                ...item,
                product_id: exactMatch.id,
                stock_batch_id: batchId,
                product_name: getProductDisplayName(exactMatch),
                available,
            });
        }));

        setItems(resolved);
        return resolved;
    };

    const onLastEditableFieldKeyDown = (e, i) => {
        if (e.key === 'Tab' && !e.shiftKey && i === items.length - 1) {
            e.preventDefault();
            addRow(true);
        }
    };

    const saveBill = async () => {
        const preparedItems = await resolveItemsForSave();
        const unresolvedItems = preparedItems.filter(item => item.product_name?.trim() && (!item.product_id || !item.stock_batch_id));
        if (unresolvedItems.length > 0) {
            addToast('Choose products from the suggestion list or type an exact product name with stock.', 'error');
            return;
        }
        const validItems = preparedItems.filter(i => i.product_id && i.stock_batch_id && i.quantity > 0);
        if (validItems.length === 0) { addToast('Add at least one product with stock', 'error'); return; }
        const billTotals = calcBill(validItems, discountAmt, isDiscountPercent);
        const paid = paidAmt === '' ? billTotals.grand : parseFloat(paidAmt);
        const outstanding = Math.max(0, billTotals.grand - paid);
        setSaving(true);
        try {
            await createSale({
                customer_id: customerId || null,
                ...(billDate ? { bill_date: billDate } : {}),
                bill_number: nextBillNo,
                subtotal: billTotals.subtotal,
                discount_amount: billTotals.extraDiscountValue,
                taxable_amount: billTotals.taxable,
                cgst_amount: billTotals.cgst,
                sgst_amount: billTotals.sgst,
                grand_total: billTotals.grand,
                paid_amount: paid,
                outstanding_amount: outstanding,
                payment_status: outstanding === 0 ? 'Paid' : paid > 0 ? 'Partial' : 'Pending',
                payment_mode: paymentMode,
                items: validItems.map(it => ({
                    product_id: it.product_id,
                    stock_batch_id: it.stock_batch_id,
                    quantity: it.quantity,
                    selling_price: it.selling_price,
                    gst_percent: it.gst_percent,
                    discount_percent: it.discount_percent,
                    final_amount: it.final_amount,
                })),
            });
            addToast(`Bill ${nextBillNo} saved!`, 'success');
            // Reset form
            setItems([emptyItem()]); setCustomerId(''); setCustomerSearch('');
            setBillDate(getTodayInputValue());
            setDiscountAmt(0); setPaidAmt(''); setIsDiscountPercent(false);
            load();
        } catch (e) {
            addToast(e?.response?.data?.detail || 'Failed to save bill', 'error');
        } finally { setSaving(false); }
    };

    // Alt+Enter → save
    useEffect(() => {
        const h = (e) => { if (e.altKey && e.key === 'Enter') saveBill(); };
        window.addEventListener('keydown', h);
        return () => window.removeEventListener('keydown', h);
    });

    const formatDisplayDate = (value) => new Date(value).toLocaleDateString('en-IN');
    const formatFileDate = (value) => {
        const date = new Date(value);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };
    const printCustomer = selectedBill?.customer || customers.find(customer => customer.id === selectedBill?.customer_id) || null;

    const handlePrint = () => {
        if (!selectedBill) return;
        const originalTitle = document.title;
        const safeBillNumber = (selectedBill.bill_number || 'bill').replace(/[\\/:*?"<>|]/g, '-');
        document.title = `bills-${safeBillNumber}-${formatFileDate(selectedBill.bill_date)}`;
        const restoreTitle = () => {
            document.title = originalTitle;
            window.removeEventListener('afterprint', restoreTitle);
        };
        window.addEventListener('afterprint', restoreTitle);
        window.setTimeout(() => {
            try {
                window.print();
            } finally {
                window.setTimeout(() => {
                    restoreTitle();
                }, 1000);
            }
        }, 100);
    };

    return (
        <div>
            {/* Tab */}
            <div className="page-header">
                <div style={{ display: 'flex', gap: '0.25rem', background: 'var(--bg-surface)', borderRadius: 10, padding: '0.25rem', border: '1px solid var(--border)' }}>
                    {[['new', ShoppingCart, 'New Bill'], ['history', CheckCircle, 'History']].map(([key, Icon, label]) => (
                        <button key={key} onClick={() => setView(key)} className="btn btn-sm" style={{
                            background: view === key ? 'var(--accent)' : 'transparent',
                            color: view === key ? '#fff' : 'var(--text-muted)',
                        }}><Icon size={14} /> {label}</button>
                    ))}
                </div>
                {view === 'new' && (
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => addRow(true)}><Plus size={14} /> Add Row <kbd className="kbd">Alt+N</kbd></button>
                        <button className="btn btn-primary" onClick={saveBill} disabled={saving}>
                            <Save size={14} /> {saving ? 'Saving…' : 'Save Bill'} <kbd className="kbd">Alt+↵</kbd>
                        </button>
                    </div>
                )}
            </div>

            {view === 'history' ? (
                <div className="surface" style={{ overflow: 'hidden' }}>
                    {bills.length === 0 ? (
                        <div className="empty-state"><ShoppingCart size={36} /><span>No bills yet</span></div>
                    ) : (
                        <table className="data-table">
                            <thead><tr><th>Bill No.</th><th>Date</th><th>Payment</th><th>Status</th><th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>Paid</th><th style={{ textAlign: 'right' }}>Due</th><th style={{ textAlign: 'right' }}>Details</th></tr></thead>
                            <tbody>
                                {bills.map(b => (
                                    <tr key={b.id} style={{ cursor: 'pointer' }} onClick={() => openDetails(b.id)}>
                                        <td style={{ fontWeight: 600 }}>{b.bill_number}</td>
                                        <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{new Date(b.bill_date).toLocaleDateString('en-IN')}</td>
                                        <td><span className="badge badge-muted">{b.payment_mode || '—'}</span></td>
                                        <td><span className={`badge ${b.payment_status === 'Paid' ? 'badge-success' : b.payment_status === 'Partial' ? 'badge-warning' : 'badge-muted'}`}>{b.payment_status}</span></td>
                                        <td style={{ textAlign: 'right', fontWeight: 600 }}>₹{b.grand_total?.toFixed(2)}</td>
                                        <td style={{ textAlign: 'right', color: 'var(--success)' }}>₹{b.paid_amount?.toFixed(2)}</td>
                                        <td style={{ textAlign: 'right', color: b.outstanding_amount > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>₹{b.outstanding_amount?.toFixed(2)}</td>
                                        <td style={{ textAlign: 'right' }}>
                                            <button className="btn-icon" title="View Details"><Eye size={14} /></button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr)', gap: '1rem', alignItems: 'start' }}>
                    {/* Bill Entry */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {/* Customer */}
                        <div className="surface" style={{ padding: '1rem', position: 'relative', zIndex: 10 }}>
                            <div className="form-group">
                                <label className="form-label">Customer (optional)</label>
                                <input value={customerSearch} onChange={e => handleCustomerSearch(e.target.value)}
                                    onKeyDown={onCustomerKeyDown}
                                    placeholder="Search by name or phone…" autoComplete="off" />
                            </div>
                            {customerSuggestions.length > 0 && (
                                <ul style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '8px', zIndex: 50, listStyle: 'none', margin: '2px 0' }}>
                                    {customerSuggestions.map((c, idx) => (
                                        <li key={c.id} onMouseDown={() => selectCustomer(c)}
                                            style={{ 
                                                padding: '0.6rem 1rem', cursor: 'pointer', fontSize: '0.85rem',
                                                background: idx === customerSuggestIndex ? 'var(--bg-hover)' : 'transparent'
                                            }}
                                            onMouseEnter={() => setCustomerSuggestIndex(idx)}
                                        >
                                            <strong>{c.name}</strong> {c.phone && <span style={{ color: 'var(--text-muted)', marginLeft: '0.5rem' }}>{c.phone}</span>}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>

                        {/* Items table */}
                        <div className="surface" style={{ overflow: 'visible', zIndex: 5 }}>
                            <div style={{ overflowX: 'visible' }}>
                                <table className="data-table" style={{ minWidth: 820 }}>
                                    <thead>
                                        <tr>
                                            <th style={{ minWidth: 220 }}>Product</th>
                                            <th style={{ width: 120 }}>Qty</th>
                                            <th style={{ width: 150 }}>Price</th>
                                            <th style={{ width: 100 }}>GST%</th>
                                            <th style={{ width: 100 }}>Disc%</th>
                                            <th style={{ textAlign: 'right', width: 130 }}>Amount</th>
                                            <th style={{ width: 40 }}></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {items.map((it, i) => (
                                            <tr key={i}>
                                                <td style={{ position: 'relative' }}>
                                                    <input
                                                        ref={el => productInputRefs.current[i] = el}
                                                        value={it.product_name}
                                                        onChange={e => handleProductSearch(i, e.target.value)}
                                                        onKeyDown={e => onProductKeyDown(e, i)}
                                                        onBlur={() => window.setTimeout(() => { void commitProductMatch(i, it.product_name); }, 120)}
                                                        placeholder="Type product name…"
                                                        style={{ fontSize: '0.82rem' }}
                                                        autoComplete="off"
                                                    />
                                                    {productSuggestions.index === i && productSuggestions.list.length > 0 && (
                                                        <ul style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '8px', zIndex: 100, listStyle: 'none', margin: '2px 0', maxHeight: 200, overflowY: 'auto' }}>
                                                            {productSuggestions.list.map((p, idx) => (
                                                                <li key={p.id} onMouseDown={() => selectProduct(i, p)}
                                                                    style={{ 
                                                                        padding: '0.55rem 0.85rem', cursor: 'pointer', fontSize: '0.82rem', display: 'flex', justifyContent: 'space-between',
                                                                        background: idx === productSuggestions.activeIdx ? 'var(--bg-hover)' : 'transparent'
                                                                     }}
                                                                    onMouseEnter={() => setProductSuggestions(s => ({ ...s, activeIdx: idx }))}
                                                                >
                                                                    <span>{p.brand_name ? <strong>{p.brand_name} </strong> : ''}{p.product_name}</span>
                                                                    <span className={`badge ${p.current_stock < 5 ? 'badge-warning' : 'badge-muted'}`}>{p.current_stock}</span>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    )}
                                                </td>
                                                <td>
                                                    <input
                                                        ref={el => itemRefs.current[i] = el}
                                                        type="number" min={1} value={it.quantity}
                                                        onChange={e => updateItem(i, 'quantity', +e.target.value)}
                                                        style={{ fontSize: '0.82rem' }}
                                                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (i === items.length - 1) addRow(true); } }}
                                                    />
                                                </td>
                                                <td>
                                                    <input type="number" min={0} step={0.01} value={it.selling_price} onChange={e => updateItem(i, 'selling_price', +e.target.value)} style={{ fontSize: '0.82rem' }} />
                                                </td>
                                                <td>
                                                    <select value={it.gst_percent} onChange={e => updateItem(i, 'gst_percent', +e.target.value)} style={{ fontSize: '0.82rem', padding: '0.4rem 0.5rem' }}>
                                                        {GST_RATES.map(r => <option key={r} value={r}>{r}%</option>)}
                                                    </select>
                                                </td>
                                                <td>
                                                    <input type="number" min={0} max={100} value={it.discount_percent} onChange={e => updateItem(i, 'discount_percent', +e.target.value)} onKeyDown={e => onLastEditableFieldKeyDown(e, i)} style={{ fontSize: '0.82rem' }} />
                                                </td>
                                                <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                                                    ₹{it.final_amount.toFixed(2)}
                                                </td>
                                                <td>
                                                    <button className="btn-icon" onClick={() => removeRow(i)} title="Remove row" style={{ opacity: items.length === 1 ? 0.3 : 1 }} disabled={items.length === 1}>
                                                        <Trash2 size={13} color="var(--danger)" />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    {/* Bill Summary Panel */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', position: 'sticky', top: 0 }}>
                        <div className="surface" style={{ padding: '1.25rem' }}>
                            <div className="form-group" style={{ marginBottom: '1rem' }}>
                                <label className="form-label">Bill Date</label>
                                <input type="date" value={billDate} onChange={e => setBillDate(e.target.value)} />
                            </div>
                            <p style={{ fontWeight: 700, marginBottom: '1rem', fontSize: '0.9rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Bill Summary</p>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.875rem' }}>
                                {[
                                    ['Subtotal', `₹${totals.subtotal.toFixed(2)}`],
                                    ['Extra Discount', `-₹${totals.extraDiscountValue.toFixed(2)}`],
                                    ['Taxable', `₹${totals.taxable.toFixed(2)}`],
                                    ['CGST', `₹${totals.cgst.toFixed(2)}`],
                                    ['SGST', `₹${totals.sgst.toFixed(2)}`],
                                ].map(([k, v]) => (
                                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
                                        <span>{k}</span><span>{v}</span>
                                    </div>
                                ))}
                                <div style={{ borderTop: '1px solid var(--border)', marginTop: '0.5rem', paddingTop: '0.5rem', display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: '1.2rem' }}>
                                    <span>Grand Total</span>
                                    <div style={{ textAlign: 'right' }}>
                                        <div style={{ color: 'var(--accent)' }}>₹{totals.grand.toFixed(2)}</div>
                                        {Math.abs(totals.grand - totals.grandExact) > 0.001 && (
                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>Exact: ₹{totals.grandExact.toFixed(2)}</div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Extra discount */}
                            <div className="form-group" style={{ marginTop: '1rem' }}>
                                <label className="form-label">Extra Discount</label>
                                <div style={{ display: 'flex', gap: '0.4rem' }}>
                                    <input type="number" min={0} value={discountAmt} onChange={e => setDiscountAmt(+e.target.value)} style={{ flex: 1 }} />
                                    <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden' }}>
                                        <button className="btn btn-sm" onClick={(e) => { e.preventDefault(); setIsDiscountPercent(false); }} style={{ borderRadius: 0, padding: '0 0.5rem', background: !isDiscountPercent ? 'var(--accent)' : 'var(--bg-elevated)', color: !isDiscountPercent ? '#fff' : 'var(--text-muted)' }}>₹</button>
                                        <button className="btn btn-sm" onClick={(e) => { e.preventDefault(); setIsDiscountPercent(true); }} style={{ borderRadius: 0, padding: '0 0.5rem', background: isDiscountPercent ? 'var(--accent)' : 'var(--bg-elevated)', color: isDiscountPercent ? '#fff' : 'var(--text-muted)' }}>%</button>
                                    </div>
                                </div>
                            </div>

                            {/* Payment mode */}
                            <div style={{ marginTop: '1rem' }}>
                                <p className="form-label" style={{ marginBottom: '0.4rem' }}>Payment Mode</p>
                                <div style={{ display: 'flex', gap: '0.4rem' }}>
                                    {['Cash', 'UPI', 'Credit'].map(m => (
                                        <button key={m} onClick={() => setPaymentMode(m)} className="btn btn-sm" style={{
                                            flex: 1,
                                            background: paymentMode === m ? 'var(--accent)' : 'var(--bg-elevated)',
                                            color: paymentMode === m ? '#fff' : 'var(--text-muted)',
                                            border: `1px solid ${paymentMode === m ? 'var(--accent)' : 'var(--border)'}`,
                                        }}>{m}</button>
                                    ))}
                                </div>
                            </div>

                            {/* Paid amount */}
                            <div className="form-group" style={{ marginTop: '0.75rem' }}>
                                <label className="form-label">Paid Amount (₹)</label>
                                <input type="number" min={0} value={paidAmt} onChange={e => setPaidAmt(e.target.value)} placeholder={totals.grand.toFixed(2)} />
                            </div>
                            {paidAmt !== '' && (
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginTop: '0.5rem', padding: '0.5rem 0.75rem', background: 'var(--bg-elevated)', borderRadius: 8 }}>
                                    <span style={{ color: 'var(--text-muted)' }}>Outstanding</span>
                                    <span style={{ fontWeight: 700, color: Math.max(0, totals.grand - +paidAmt) > 0 ? 'var(--danger)' : 'var(--success)' }}>
                                        ₹{Math.max(0, totals.grand - +paidAmt).toFixed(2)}
                                    </span>
                                </div>
                            )}

                            <button className="btn btn-primary" style={{ width: '100%', marginTop: '1rem', justifyContent: 'center' }} onClick={saveBill} disabled={saving}>
                                <Save size={15} /> {saving ? 'Saving…' : 'Save Bill'} <kbd className="kbd" style={{ marginLeft: '0.25rem' }}>Alt+↵</kbd>
                            </button>
                        </div>

                        <div className="surface" style={{ padding: '0.75rem 1rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            <p style={{ marginBottom: '0.3rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Keyboard shortcuts</p>
                            <p><kbd className="kbd">Tab</kbd> — move between fields / select item</p>
                            <p style={{ marginTop: '0.2rem' }}><kbd className="kbd">Alt+N</kbd> — add item row</p>
                            <p style={{ marginTop: '0.2rem' }}><kbd className="kbd">Enter</kbd> on last qty — new row</p>
                            <p style={{ marginTop: '0.2rem' }}><kbd className="kbd">Alt+↵</kbd> — save bill</p>
                        </div>
                    </div>
                </div>
            )}
            
            {/* Sales Bill Details Modal */}
            {selectedBill && (
                <Modal title={`Bill Details: ${selectedBill.bill_number}`} onClose={() => setSelectedBill(null)} footer={
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button className="btn btn-primary" onClick={handlePrint}><Printer size={15} /> Print</button>
                        <button className="btn btn-ghost" onClick={() => setSelectedBill(null)}>Close</button>
                    </div>
                }>
                    <div className="no-print">
                        <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                            <div>
                                <strong>Customer:</strong> {printCustomer?.name || 'Walk-in Customer'}
                                {printCustomer?.address ? `, ${printCustomer.address}` : ''}
                            </div>
                            <div><strong>Date:</strong> {formatDisplayDate(selectedBill.bill_date)}</div>
                        </div>
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Product Name</th>
                                    <th>Qty</th>
                                    <th>Rate</th>
                                    <th>Disc%</th>
                                    <th>GST%</th>
                                    <th style={{ textAlign: 'right' }}>Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                {selectedBill.sales_items?.map(it => (
                                    <tr key={it.id}>
                                        <td>{getSaleItemDisplayName(it)}</td>
                                        <td>{it.quantity}</td>
                                        <td>₹{it.selling_price.toFixed(2)}</td>
                                        <td>{it.discount_percent}%</td>
                                        <td>{it.gst_percent}%</td>
                                        <td style={{ textAlign: 'right', fontWeight: 600 }}>₹{it.final_amount.toFixed(2)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', fontSize: '0.9rem', gap: '0.3rem' }}>
                            <div>Subtotal: ₹{selectedBill.subtotal.toFixed(2)}</div>
                            {selectedBill.discount_amount > 0 && <div>Extra Discount: -₹{selectedBill.discount_amount.toFixed(2)}</div>}
                            <div>Taxable: ₹{selectedBill.taxable_amount.toFixed(2)}</div>
                            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', marginTop: '0.4rem' }}>
                                Grand Total: <span style={{ color: 'var(--accent)' }}>₹{selectedBill.grand_total.toFixed(2)}</span>
                            </div>
                            <div style={{ color: 'var(--success)', marginTop: '0.4rem' }}>Paid: ₹{selectedBill.paid_amount.toFixed(2)}</div>
                            {selectedBill.outstanding_amount > 0 && <div style={{ color: 'var(--danger)' }}>Outstanding: ₹{selectedBill.outstanding_amount.toFixed(2)}</div>}
                        </div>
                    </div>
                </Modal>
            )}

            {/* Hidden Printable Invoice */}
            {selectedBill && settings && (
                <div className="printable-area">
                    <div style={{ padding: '22px 26px', color: '#000', background: '#fff', fontSize: '12px', lineHeight: 1.25 }}>
                        <div style={{ textAlign: 'center', marginBottom: '14px', borderBottom: '1px solid #333', paddingBottom: '10px' }}>
                            <h1 style={{ margin: 0, fontSize: '22px', color: '#000', lineHeight: 1.1 }}>{settings.company_name}</h1>
                            {settings.tagline && <p style={{ margin: '3px 0', fontSize: '12px', fontStyle: 'italic' }}>{settings.tagline}</p>}
                            <p style={{ margin: '3px 0 0 0', fontSize: '11px' }}>
                                {settings.address}, {settings.city}, {settings.state} - {settings.pincode}
                            </p>
                            <p style={{ margin: '3px 0 0 0', fontSize: '11px' }}>
                                Ph: {settings.phone} | Email: {settings.email}
                            </p>
                            {settings.gst_number && (
                                <p style={{ margin: '3px 0 0 0', fontSize: '11px', fontWeight: 'bold' }}>
                                    GSTIN: {settings.gst_number}
                                </p>
                            )}
                        </div>

                        <div style={{ textAlign: 'center', marginBottom: '12px' }}>
                            <div style={{ fontSize: '15px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Tax Invoice</div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '18px', marginBottom: '14px' }}>
                            <div>
                                <div style={{ fontSize: '11px', color: '#555', textTransform: 'uppercase', fontWeight: 'bold', marginBottom: '5px' }}>Customer Details</div>
                                <div style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: '3px' }}>{printCustomer?.name || 'Walk-in Customer'}</div>
                                {printCustomer?.address && <div style={{ marginBottom: '3px' }}>{printCustomer.address}</div>}
                                {printCustomer?.phone && <div>Phone: {printCustomer.phone}</div>}
                            </div>
                            <div style={{ textAlign: 'right', minWidth: '180px' }}>
                                <div style={{ fontSize: '11px', color: '#555', textTransform: 'uppercase', fontWeight: 'bold', marginBottom: '5px' }}>Bill Details</div>
                                <div style={{ fontWeight: 'bold', marginBottom: '3px' }}>Bill No: {selectedBill.bill_number}</div>
                                <div>Date: {formatDisplayDate(selectedBill.bill_date)}</div>
                            </div>
                        </div>

                        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '14px' }}>
                            <thead>
                                <tr style={{ background: '#f5f5f5' }}>
                                    <th style={{ padding: '6px 7px', border: '1px solid #ccc', textAlign: 'left' }}>S.N.</th>
                                    <th style={{ padding: '6px 7px', border: '1px solid #ccc', textAlign: 'left' }}>Description</th>
                                    <th style={{ padding: '6px 7px', border: '1px solid #ccc', textAlign: 'center' }}>Qty</th>
                                    <th style={{ padding: '6px 7px', border: '1px solid #ccc', textAlign: 'right' }}>Rate</th>
                                    <th style={{ padding: '6px 7px', border: '1px solid #ccc', textAlign: 'right' }}>Amount</th>
                                </tr>
                            </thead>
                            <tbody>
                                {selectedBill.sales_items?.map((it, idx) => (
                                    <tr key={it.id}>
                                        <td style={{ padding: '5px 7px', border: '1px solid #ccc', verticalAlign: 'top' }}>{idx + 1}</td>
                                        <td style={{ padding: '5px 7px', border: '1px solid #ccc' }}>
                                            {getSaleItemDisplayName(it)}
                                            <div style={{ fontSize: '10px', color: '#555', marginTop: '2px' }}>
                                                HSN: — | GST: {it.gst_percent}% | Disc: {it.discount_percent}%
                                            </div>
                                        </td>
                                        <td style={{ padding: '5px 7px', border: '1px solid #ccc', textAlign: 'center', verticalAlign: 'top' }}>{it.quantity}</td>
                                        <td style={{ padding: '5px 7px', border: '1px solid #ccc', textAlign: 'right', verticalAlign: 'top' }}>{it.selling_price.toFixed(2)}</td>
                                        <td style={{ padding: '5px 7px', border: '1px solid #ccc', textAlign: 'right', verticalAlign: 'top' }}>{it.final_amount.toFixed(2)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <table style={{ width: '300px', borderCollapse: 'collapse' }}>
                                <tbody>
                                    <tr>
                                        <td style={{ padding: '5px 6px', textAlign: 'right' }}>Subtotal:</td>
                                        <td style={{ padding: '5px 6px', textAlign: 'right', fontWeight: 'bold' }}>₹{selectedBill.subtotal.toFixed(2)}</td>
                                    </tr>
                                    {selectedBill.discount_amount > 0 && (
                                        <tr>
                                            <td style={{ padding: '5px 6px', textAlign: 'right' }}>Discount:</td>
                                            <td style={{ padding: '5px 6px', textAlign: 'right', fontWeight: 'bold' }}>-₹{selectedBill.discount_amount.toFixed(2)}</td>
                                        </tr>
                                    )}
                                    <tr>
                                        <td style={{ padding: '5px 6px', textAlign: 'right' }}>Taxable Value:</td>
                                        <td style={{ padding: '5px 6px', textAlign: 'right', fontWeight: 'bold' }}>₹{selectedBill.taxable_amount.toFixed(2)}</td>
                                    </tr>
                                    <tr>
                                        <td style={{ padding: '5px 6px', textAlign: 'right' }}>CGST:</td>
                                        <td style={{ padding: '5px 6px', textAlign: 'right', fontWeight: 'bold' }}>₹{selectedBill.cgst_amount.toFixed(2)}</td>
                                    </tr>
                                    <tr>
                                        <td style={{ padding: '5px 6px', textAlign: 'right' }}>SGST:</td>
                                        <td style={{ padding: '5px 6px', textAlign: 'right', fontWeight: 'bold' }}>₹{selectedBill.sgst_amount.toFixed(2)}</td>
                                    </tr>
                                    <tr style={{ borderTop: '2px solid #000', borderBottom: '2px solid #000' }}>
                                        <td style={{ padding: '8px 6px', textAlign: 'right', fontSize: '15px', fontWeight: 'bold' }}>Grand Total:</td>
                                        <td style={{ padding: '8px 6px', textAlign: 'right', fontSize: '15px', fontWeight: 'bold' }}>₹{selectedBill.grand_total.toFixed(2)}</td>
                                    </tr>
                                    {selectedBill.payment_mode && (
                                        <tr>
                                            <td colSpan="2" style={{ padding: '5px 6px', textAlign: 'right', fontStyle: 'italic' }}>
                                                Paid via {selectedBill.payment_mode}
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {settings.invoice_footer && (
                            <div style={{ marginTop: '18px', paddingTop: '10px', borderTop: '1px solid #eee', fontSize: '11px', textAlign: 'center', color: '#555' }}>
                                {settings.invoice_footer}
                            </div>
                        )}
                        <div style={{ marginTop: '18px', textAlign: 'right', fontSize: '12px', fontWeight: 'bold', paddingRight: '8px' }}>
                            Authorized Signatory
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
