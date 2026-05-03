import { useEffect, useState, useCallback, useRef } from 'react';
import { Plus, Trash2, Truck, Save, ClipboardList, Eye } from 'lucide-react';
import { getProducts, getSuppliers, getPurchaseInvoices, createPurchaseInvoice, getPurchaseInvoice } from '../api';
import { useKeyboardShortcut } from '../hooks/useKeyboard';
import { useToast } from '../hooks/useToast';
import Modal from '../components/Modal';

function emptyItem() {
    return { product_id: '', product_name: '', quantity: 1, unit_price: 0, gst_percent: 12, line_total: 0 };
}

function normalizeText(value = '') {
    return value.toLowerCase().trim().replace(/\s+/g, ' ');
}

function getProductDisplayName(product) {
    return [product.brand_name, product.product_name].filter(Boolean).join(' ');
}

function getPurchaseItemDisplayName(item) {
    if (item?.product_name_snapshot) return item.product_name_snapshot;
    if (item?.product) return getProductDisplayName(item.product);
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

function findExactSupplierMatch(suppliers, rawQuery) {
    const query = normalizeText(rawQuery);
    if (!query) return null;
    const matches = suppliers.filter(supplier => normalizeText(supplier.company_name) === query);
    return matches.length === 1 ? matches[0] : null;
}

// calcItem handles both tax-inclusive and tax-exclusive modes
// priceIncludesTax: false = exclusive (user enters base price, system adds tax)
// priceIncludesTax: true = inclusive (user enters final price, system calculates base + tax)
function calcItem(it, priceIncludesTax = false) {
    const qty = Number(it.quantity) || 0;
    const taxRate = Number(it.gst_percent) || 0;
    const unitPrice = Number(it.unit_price) || 0;

    if (priceIncludesTax) {
        const grossTotal = unitPrice * qty;
        const baseTotal = taxRate > 0 ? grossTotal / (1 + taxRate / 100) : grossTotal;
        const gst = grossTotal - baseTotal;
        const baseUnitPrice = qty > 0 ? baseTotal / qty : 0;
        return {
            ...it,
            line_total: +grossTotal.toFixed(2),
            base_unit_price: +baseUnitPrice.toFixed(4),
            gst_amount: +gst.toFixed(2),
        };
    } else {
        const baseTotal = unitPrice * qty;
        const gst = baseTotal * taxRate / 100;
        return {
            ...it,
            line_total: +(baseTotal + gst).toFixed(2),
            base_unit_price: +unitPrice.toFixed(4),
            gst_amount: +gst.toFixed(2),
        };
    }
}

export default function Purchases() {
    const { addToast } = useToast();
    const [products, setProducts] = useState([]);
    const [suppliers, setSuppliers] = useState([]);
    const [invoices, setInvoices] = useState([]);
    const [view, setView] = useState('new');
    const [supplierId, setSupplierId] = useState('');
    const [supplierSearch, setSupplierSearch] = useState('');
    const [supplierSuggestions, setSupplierSuggestions] = useState([]);
    const [supplierSuggestIndex, setSupplierSuggestIndex] = useState(-1);
    
    const [invoiceNo, setInvoiceNo] = useState('');
    const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
    const [items, setItems] = useState([emptyItem()]);
    const [saving, setSaving] = useState(false);
    const [priceIncludesTax, setPriceIncludesTax] = useState(false); // Bill-level tax toggle
    
    const [productSuggestions, setProductSuggestions] = useState({ index: null, list: [], activeIdx: -1 });
    const [selectedInvoice, setSelectedInvoice] = useState(null);
    
    const itemRefs = useRef([]);
    const productInputRefs = useRef([]);

    const load = useCallback(async () => {
        try {
            const [pRes, sRes, invRes] = await Promise.all([getProducts(), getSuppliers(), getPurchaseInvoices()]);
            setProducts(pRes.data);
            setSuppliers(sRes.data);
            setInvoices([...invRes.data].reverse());
        } catch { addToast('Failed to load data', 'error'); }
    }, [addToast]);

    useEffect(() => { load(); }, [load]);

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
            next[i] = calcItem({ ...next[i], [field]: val }, priceIncludesTax);
            return next;
        });
    };

    const handleProductSearch = (i, val) => {
        updateItem(i, 'product_name', val);
        updateItem(i, 'product_id', '');
        if (val.length < 2) { setProductSuggestions({ index: null, list: [], activeIdx: -1 }); return; }
        setProductSuggestions({
            index: i, activeIdx: -1, list: products.filter(p =>
                matchesProductSearch(p, val)
            ).slice(0, 8)
        });
    };

    const applyProductSelection = (i, product, focusQuantity = true) => {
        setProductSuggestions({ index: null, list: [], activeIdx: -1 });
        setItems(prev => {
            const next = [...prev];
            next[i] = calcItem({ ...next[i], product_id: product.id, product_name: getProductDisplayName(product) }, priceIncludesTax);
            return next;
        });
        if (focusQuantity) {
            window.setTimeout(() => itemRefs.current[i]?.focus(), 50);
        }
    };

    const selectProduct = (i, product) => {
        applyProductSelection(i, product, true);
    };

    const commitProductMatch = (i, rawValue) => {
        const exactMatch = findExactProductMatch(products, rawValue);
        if (exactMatch) {
            applyProductSelection(i, exactMatch, false);
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

    const handleSupplierSearch = (val) => {
        const exactMatch = findExactSupplierMatch(suppliers, val);
        setSupplierSearch(val);
        setSupplierId(exactMatch ? exactMatch.id : '');
        setSupplierSuggestIndex(-1);
        setSupplierSuggestions(val ? suppliers.filter(s => normalizeText(s.company_name).includes(normalizeText(val))).slice(0, 6) : []);
    };

    const commitSupplierMatch = (rawValue) => {
        const exactMatch = findExactSupplierMatch(suppliers, rawValue);
        if (exactMatch) {
            setSupplierId(exactMatch.id);
            setSupplierSearch(exactMatch.company_name);
        }
        setSupplierSuggestions([]);
        return exactMatch;
    };
    
    const onSupplierKeyDown = (e) => {
        if (supplierSuggestions.length === 0) return;
        
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSupplierSuggestIndex(i => Math.min(i + 1, supplierSuggestions.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSupplierSuggestIndex(i => Math.max(i - 1, -1));
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            if (supplierSuggestIndex >= 0 && supplierSuggestIndex < supplierSuggestions.length) {
                e.preventDefault();
                const s = supplierSuggestions[supplierSuggestIndex];
                setSupplierId(s.id); setSupplierSearch(s.company_name); setSupplierSuggestions([]);
            } else if (e.key === 'Tab' && supplierSuggestions.length > 0) {
                e.preventDefault();
                const s = supplierSuggestions[0];
                setSupplierId(s.id); setSupplierSearch(s.company_name); setSupplierSuggestions([]);
            }
        } else if (e.key === 'Escape') {
            setSupplierSuggestions([]);
        }
    };

    const openDetails = async (id) => {
        try {
            const res = await getPurchaseInvoice(id);
            setSelectedInvoice(res.data);
        } catch { addToast('Failed to load details', 'error'); }
    };

    const totalAmount = items.reduce((s, it) => s + (it.line_total || 0), 0);
    const totalQuantity = items.filter(it => it.product_id).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
    const resolveItemsForSave = () => items.map(it => {
        if (it.product_id || !it.product_name?.trim()) return it;
        const exactMatch = findExactProductMatch(products, it.product_name);
        return exactMatch
            ? calcItem({ ...it, product_id: exactMatch.id, product_name: getProductDisplayName(exactMatch) }, priceIncludesTax)
            : it;
    });

    const getPurchasePayloadItem = (item) => {
        const taxRate = Number(item.gst_percent) || 0;
        const enteredUnitPrice = Number(item.unit_price) || 0;
        const baseUnitPrice = priceIncludesTax && taxRate > 0
            ? enteredUnitPrice / (1 + taxRate / 100)
            : enteredUnitPrice;
        return {
            product_id: item.product_id,
            quantity: item.quantity,
            unit_price: +baseUnitPrice.toFixed(4),
            gst_percent: item.gst_percent,
            line_total: item.line_total,
        };
    };

    const onTaxFieldKeyDown = (e, i) => {
        if (e.key === 'Tab' && !e.shiftKey && i === items.length - 1) {
            e.preventDefault();
            addRow(true);
        }
    };

    const saveInvoice = async () => {
        const matchedSupplier = supplierId
            ? suppliers.find(s => s.id === Number(supplierId))
            : commitSupplierMatch(supplierSearch);
        if (!matchedSupplier) { addToast('Select a supplier', 'error'); return; }
        if (!invoiceNo.trim()) { addToast('Invoice number is required', 'error'); return; }
        const preparedItems = resolveItemsForSave();
        setItems(preparedItems);
        const unresolvedItems = preparedItems.filter(it => it.product_name?.trim() && !it.product_id);
        if (unresolvedItems.length > 0) {
            addToast('Choose products from the suggestion list or type an exact product name.', 'error');
            return;
        }
        const validItems = preparedItems.filter(it => it.product_id && it.quantity > 0);
        if (validItems.length === 0) { addToast('Add at least one mapped product (select from suggestion)', 'error'); return; }
        const invoiceTotal = validItems.reduce((sum, item) => sum + (item.line_total || 0), 0);
        
        setSaving(true);
        try {
            await createPurchaseInvoice({
                supplier_id: matchedSupplier.id,
                invoice_number: invoiceNo,
                invoice_date: invoiceDate,
                total_amount: +invoiceTotal.toFixed(2),
                items: validItems.map(getPurchasePayloadItem),
            });
            addToast('Purchase invoice saved!', 'success');
            setItems([emptyItem()]); setSupplierId(''); setSupplierSearch('');
            setInvoiceNo(''); setInvoiceDate(new Date().toISOString().slice(0, 10));
            load();
        } catch (e) {
            addToast(e?.response?.data?.detail || 'Save failed', 'error');
        } finally { setSaving(false); }
    };

    return (
        <div>
            <div className="page-header">
                <div style={{ display: 'flex', gap: '0.25rem', background: 'var(--bg-surface)', borderRadius: 10, padding: '0.25rem', border: '1px solid var(--border)' }}>
                    {[['new', Truck, 'New Invoice'], ['history', ClipboardList, 'History']].map(([key, Icon, label]) => (
                        <button key={key} onClick={() => setView(key)} className="btn btn-sm" style={{
                            background: view === key ? 'var(--accent)' : 'transparent',
                            color: view === key ? '#fff' : 'var(--text-muted)',
                        }}><Icon size={14} /> {label}</button>
                    ))}
                </div>
                {view === 'new' && (
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => addRow(true)}><Plus size={14} /> Add Row <kbd className="kbd">Alt+N</kbd></button>
                        <button className="btn btn-primary" onClick={saveInvoice} disabled={saving}>
                            <Save size={14} /> {saving ? 'Saving…' : 'Save Invoice'} <kbd className="kbd">Alt+↵</kbd>
                        </button>
                    </div>
                )}
            </div>

            {view === 'history' ? (
                <div className="surface" style={{ overflow: 'hidden' }}>
                    {invoices.length === 0 ? (
                        <div className="empty-state"><Truck size={36} /><span>No invoices yet</span></div>
                    ) : (
                        <table className="data-table">
                            <thead><tr><th>Invoice No.</th><th>Date</th><th>Supplier ID</th><th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>Details</th></tr></thead>
                            <tbody>
                                {invoices.map(inv => (
                                    <tr key={inv.id} style={{ cursor: 'pointer' }} onClick={() => openDetails(inv.id)}>
                                        <td style={{ fontWeight: 600 }}>{inv.invoice_number || `#${inv.id}`}</td>
                                        <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{new Date(inv.invoice_date).toLocaleDateString('en-IN')}</td>
                                        <td style={{ color: 'var(--text-secondary)' }}>{inv.supplier_id}</td>
                                        <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--accent)' }}>₹{inv.total_amount?.toFixed(2)}</td>
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
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {/* Header fields */}
                        <div className="surface" style={{ padding: '1rem' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
                                {/* Supplier */}
                                <div className="form-group" style={{ position: 'relative', gridColumn: '1 / span 2' }}>
                                    <label className="form-label">Supplier *</label>
                                    <input value={supplierSearch} onChange={e => handleSupplierSearch(e.target.value)}
                                        onKeyDown={onSupplierKeyDown}
                                        onBlur={() => window.setTimeout(() => commitSupplierMatch(supplierSearch), 120)}
                                        placeholder="Search supplier…" autoComplete="off" />
                                    {supplierSuggestions.length > 0 && (
                                        <ul style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '8px', zIndex: 100, listStyle: 'none', margin: '2px 0', maxHeight: 180, overflowY: 'auto' }}>
                                            {supplierSuggestions.map((s, idx) => (
                                                <li key={s.id}
                                                    onMouseDown={() => { setSupplierId(s.id); setSupplierSearch(s.company_name); setSupplierSuggestions([]); }}
                                                    style={{ 
                                                        padding: '0.55rem 0.85rem', cursor: 'pointer', fontSize: '0.85rem',
                                                        background: idx === supplierSuggestIndex ? 'var(--bg-hover)' : 'transparent'
                                                    }}
                                                    onMouseEnter={() => setSupplierSuggestIndex(idx)}
                                                >{s.company_name}</li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Invoice Date</label>
                                    <input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Invoice Number *</label>
                                    <input value={invoiceNo} onChange={e => setInvoiceNo(e.target.value)} placeholder="Required" />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Price Type</label>
                                    <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden' }}>
                                        <button className="btn btn-sm" onClick={() => { setPriceIncludesTax(false); setItems(prev => prev.map(it => calcItem(it, false))); }} style={{ flex: 1, borderRadius: 0, padding: '0.4rem 0.5rem', background: !priceIncludesTax ? 'var(--accent)' : 'var(--bg-elevated)', color: !priceIncludesTax ? '#fff' : 'var(--text-muted)', border: 'none' }}>Exclusive</button>
                                        <button className="btn btn-sm" onClick={() => { setPriceIncludesTax(true); setItems(prev => prev.map(it => calcItem(it, true))); }} style={{ flex: 1, borderRadius: 0, padding: '0.4rem 0.5rem', background: priceIncludesTax ? 'var(--accent)' : 'var(--bg-elevated)', color: priceIncludesTax ? '#fff' : 'var(--text-muted)', border: 'none' }}>Inclusive</button>
                                    </div>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Unit Price Mode</label>
                                    <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', paddingTop: '0.55rem' }}>
                                        {priceIncludesTax ? 'Enter price including GST; the invoice stores the computed base unit price.' : 'Enter base price before GST; GST is added to each line total.'}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Items */}
                        <div className="surface" style={{ overflow: 'visible' }}> 
                            <div style={{ overflowX: 'visible' }}> 
                                <table className="data-table" style={{ minWidth: 760 }}>
                                    <thead>
                                        <tr>
                                            <th style={{ minWidth: 220 }}>Product</th>
                                            <th style={{ width: 120 }}>Qty</th>
                                            <th style={{ width: 160 }}>{priceIncludesTax ? 'Unit Price (Incl.)' : 'Unit Price'}</th>
                                            <th style={{ width: 110 }}>GST%</th>
                                            <th style={{ textAlign: 'right', width: 140 }}>Line Total</th>
                                            <th style={{ width: 40 }}></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {items.map((it, i) => (
                                            <tr key={i}>
                                                <td style={{ position: 'relative' }}>
                                                    <input ref={el => productInputRefs.current[i] = el} value={it.product_name} onChange={e => handleProductSearch(i, e.target.value)}
                                                        onKeyDown={e => onProductKeyDown(e, i)}
                                                        onBlur={() => window.setTimeout(() => commitProductMatch(i, it.product_name), 120)}
                                                        placeholder="Type product…" style={{ fontSize: '0.82rem' }} autoComplete="off" />
                                                    {productSuggestions.index === i && productSuggestions.list.length > 0 && (
                                                        <ul style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '8px', zIndex: 9999, listStyle: 'none', margin: '2px 0', maxHeight: 200, overflowY: 'auto' }}>
                                                            {productSuggestions.list.map((p, idx) => (
                                                                <li key={p.id} onMouseDown={() => selectProduct(i, p)}
                                                                    style={{ 
                                                                        padding: '0.55rem 0.85rem', cursor: 'pointer', fontSize: '0.82rem', display: 'flex', justifyContent: 'space-between',
                                                                        background: idx === productSuggestions.activeIdx ? 'var(--bg-hover)' : 'transparent'
                                                                    }}
                                                                    onMouseEnter={() => setProductSuggestions(s => ({ ...s, activeIdx: idx }))}
                                                                >
                                                                    <span>{p.brand_name ? <strong>{p.brand_name} </strong> : ''}{p.product_name}</span>
                                                                    <span className="badge badge-muted">{p.current_stock}</span>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    )}
                                                </td>
                                                <td>
                                                    <input ref={el => itemRefs.current[i] = el} type="number" min={1} value={it.quantity}
                                                        onChange={e => updateItem(i, 'quantity', +e.target.value)} style={{ fontSize: '0.82rem' }}
                                                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (i === items.length - 1) addRow(true); } }} />
                                                </td>
                                                <td>
                                                    <input type="number" min={0} step={0.01} value={it.unit_price}
                                                        onChange={e => updateItem(i, 'unit_price', +e.target.value)} style={{ fontSize: '0.82rem' }} />
                                                </td>
                                                <td>
                                                    <select value={it.gst_percent} onChange={e => updateItem(i, 'gst_percent', +e.target.value)} onKeyDown={e => onTaxFieldKeyDown(e, i)} style={{ fontSize: '0.82rem', padding: '0.4rem 0.5rem' }}>
                                                        {[0, 5, 12, 18, 28].map(r => <option key={r} value={r}>{r}%</option>)}
                                                    </select>
                                                </td>
                                                <td style={{ textAlign: 'right', fontWeight: 600, fontSize: '0.85rem' }}>₹{it.line_total.toFixed(2)}</td>
                                                <td>
                                                    <button className="btn-icon" onClick={() => removeRow(i)} disabled={items.length === 1} style={{ opacity: items.length === 1 ? 0.3 : 1 }}>
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

                    {/* Summary */}
                    <div className="surface" style={{ padding: '1.25rem', position: 'sticky', top: 0 }}>
                        <p style={{ fontWeight: 700, marginBottom: '1rem', fontSize: '0.9rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Invoice Summary</p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {items.filter(it => it.product_id).map((it, i) => (
                                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>{it.product_name}</span>
                                    <span>×{it.quantity} = ₹{it.line_total.toFixed(2)}</span>
                                </div>
                            ))}
                        </div>
                        <div style={{ marginTop: '0.75rem', display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                            <span>Total Qty</span>
                            <span>{totalQuantity}</span>
                        </div>
                        <div style={{ borderTop: '1px solid var(--border)', marginTop: '0.75rem', paddingTop: '0.75rem', display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: '1.1rem' }}>
                            <span>Total</span>
                            <span style={{ color: 'var(--accent)' }}>₹{totalAmount.toFixed(2)}</span>
                        </div>
                        <button className="btn btn-primary" style={{ width: '100%', marginTop: '1.25rem', justifyContent: 'center' }} onClick={saveInvoice} disabled={saving}>
                            <Save size={15} /> {saving ? 'Saving…' : 'Save Invoice'} <kbd className="kbd" style={{ marginLeft: '0.25rem' }}>Alt+↵</kbd>
                        </button>
                    </div>
                </div>
            )}

            {/* Invoice Details Modal */}
            {selectedInvoice && (
                <Modal title={`Invoice Details: ${selectedInvoice.invoice_number}`} onClose={() => setSelectedInvoice(null)} footer={<button className="btn btn-ghost" onClick={() => setSelectedInvoice(null)}>Close</button>}>
                    <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                        <div><strong>Date:</strong> {new Date(selectedInvoice.invoice_date).toLocaleDateString('en-IN')}</div>
                        <div><strong>Supplier ID:</strong> {selectedInvoice.supplier_id}</div>
                    </div>
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Product Name</th>
                                <th>Qty</th>
                                <th>Unit Price</th>
                                <th>GST%</th>
                                <th style={{ textAlign: 'right' }}>Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            {selectedInvoice.purchase_items?.map(it => (
                                <tr key={it.id}>
                                    <td>{getPurchaseItemDisplayName(it)}</td>
                                    <td>{it.quantity}</td>
                                    <td>₹{it.unit_price.toFixed(2)}</td>
                                    <td>{it.gst_percent}%</td>
                                    <td style={{ textAlign: 'right', fontWeight: 600 }}>₹{it.line_total.toFixed(2)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <div style={{ marginTop: '1rem', textAlign: 'right', fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        Total Qty: {selectedInvoice.total_quantity ?? selectedInvoice.purchase_items?.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)}
                    </div>
                    <div style={{ marginTop: '1rem', textAlign: 'right', fontSize: '1.2rem', fontWeight: 'bold' }}>
                        Grand Total: <span style={{ color: 'var(--accent)' }}>₹{selectedInvoice.total_amount.toFixed(2)}</span>
                    </div>
                </Modal>
            )}
        </div>
    );
}
