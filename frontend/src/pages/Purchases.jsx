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

function getApiErrorMessage(error, fallback) {
    const message = error?.response?.data?.detail || error?.message || fallback;
    const requestId = error?.response?.headers?.['x-request-id'] || error?.response?.data?.request_id;
    return requestId ? `${message} (Ref: ${requestId})` : message;
}

function createClientRequestId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `purchase-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
    const saveInFlightRef = useRef(false);
    const purchaseRequestKeyRef = useRef('');
    const purchaseDraftFingerprintRef = useRef('');

    const load = useCallback(async () => {
        const [productsResult, suppliersResult, invoicesResult] = await Promise.allSettled([
            getProducts(),
            getSuppliers(),
            getPurchaseInvoices(),
        ]);

        if (productsResult.status === 'fulfilled') {
            setProducts(productsResult.value.data);
        } else {
            addToast(getApiErrorMessage(productsResult.reason, 'Failed to load products'), 'error');
        }

        if (suppliersResult.status === 'fulfilled') {
            setSuppliers(suppliersResult.value.data);
        } else {
            addToast(getApiErrorMessage(suppliersResult.reason, 'Failed to load suppliers'), 'error');
        }

        if (invoicesResult.status === 'fulfilled') {
            setInvoices([...invoicesResult.value.data].reverse());
        } else {
            addToast(getApiErrorMessage(invoicesResult.reason, 'Failed to load purchase history'), 'error');
        }
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
        } catch (error) {
            addToast(getApiErrorMessage(error, 'Failed to load purchase details'), 'error');
        }
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
        if (saving || saveInFlightRef.current) return;

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
        const payload = {
            supplier_id: matchedSupplier.id,
            invoice_number: invoiceNo,
            invoice_date: invoiceDate,
            total_amount: +invoiceTotal.toFixed(2),
            items: validItems.map(getPurchasePayloadItem),
        };
        const draftFingerprint = JSON.stringify(payload);
        if (!purchaseRequestKeyRef.current || purchaseDraftFingerprintRef.current !== draftFingerprint) {
            purchaseRequestKeyRef.current = createClientRequestId();
            purchaseDraftFingerprintRef.current = draftFingerprint;
        }
        
        saveInFlightRef.current = true;
        setSaving(true);
        try {
            await createPurchaseInvoice(payload, {
                headers: {
                    'X-Idempotency-Key': purchaseRequestKeyRef.current,
                },
            });
            addToast('Purchase invoice saved!', 'success');
            setItems([emptyItem()]); setSupplierId(''); setSupplierSearch('');
            setInvoiceNo(''); setInvoiceDate(new Date().toISOString().slice(0, 10));
            purchaseRequestKeyRef.current = '';
            purchaseDraftFingerprintRef.current = '';
            load();
        } catch (e) {
            addToast(getApiErrorMessage(e, 'Save failed'), 'error');
        } finally {
            saveInFlightRef.current = false;
            setSaving(false);
        }
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
                    <div className="page-header-actions">
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
                <div className="entry-layout purchase-entry-layout">
                    <div className="entry-main">
                        <div className="surface" style={{ padding: '1rem' }}>
                            <div className="entry-info-grid purchase-info-grid">
                                <div className="form-group entry-span-2" style={{ position: 'relative' }}>
                                    <label className="form-label">Supplier *</label>
                                    <input
                                        value={supplierSearch}
                                        onChange={e => handleSupplierSearch(e.target.value)}
                                        onKeyDown={onSupplierKeyDown}
                                        onBlur={() => window.setTimeout(() => commitSupplierMatch(supplierSearch), 120)}
                                        placeholder="Search supplier..."
                                        autoComplete="off"
                                    />
                                    {supplierSuggestions.length > 0 && (
                                        <ul className="line-item-suggestions scrollbar">
                                            {supplierSuggestions.map((s, idx) => (
                                                <li
                                                    key={s.id}
                                                    onMouseDown={() => { setSupplierId(s.id); setSupplierSearch(s.company_name); setSupplierSuggestions([]); }}
                                                    onMouseEnter={() => setSupplierSuggestIndex(idx)}
                                                    className="line-item-suggestion"
                                                    style={{ background: idx === supplierSuggestIndex ? 'var(--bg-hover)' : 'transparent' }}
                                                >
                                                    <span>{s.company_name}</span>
                                                </li>
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
                                    <div className="segment-control">
                                        <button className={`segment-control__button ${!priceIncludesTax ? 'is-active' : ''}`} onClick={() => { setPriceIncludesTax(false); setItems(prev => prev.map(it => calcItem(it, false))); }}>
                                            Exclusive
                                        </button>
                                        <button className={`segment-control__button ${priceIncludesTax ? 'is-active' : ''}`} onClick={() => { setPriceIncludesTax(true); setItems(prev => prev.map(it => calcItem(it, true))); }}>
                                            Inclusive
                                        </button>
                                    </div>
                                    <span className="line-item-secondary">
                                        {priceIncludesTax ? 'Enter the GST-inclusive price. The stored unit price is back-calculated.' : 'Enter the base unit price. GST is added into each row total.'}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="surface line-items-surface">
                            <div className="line-items-header">
                                <div>
                                    <p className="line-items-title">Invoice Items</p>
                                    <p className="line-items-subtitle">Only the essential columns stay visible so product entry always fits inside the page.</p>
                                </div>
                                <div className="line-items-actions">
                                    <button className="btn btn-ghost btn-sm" onClick={() => addRow(true)}><Plus size={14} /> Add Row <kbd className="kbd">Alt+N</kbd></button>
                                </div>
                            </div>
                            <div className="line-items-list">
                                <div className="line-items-head line-item-grid purchase-line-item-grid">
                                    <div className="line-item-head">Product</div>
                                    <div className="line-item-head">Qty</div>
                                    <div className="line-item-head">Unit Price</div>
                                    <div className="line-item-head">GST</div>
                                    <div className="line-item-head line-item-head--amount">Amount</div>
                                    <div className="line-item-head line-item-head--action" aria-hidden="true"> </div>
                                </div>
                                {items.map((it, i) => {
                                    const currentProduct = products.find(product => product.id === it.product_id);
                                    return (
                                        <div key={i} className="line-item-row line-item-grid purchase-line-item-grid">
                                            <div className="line-item-cell line-item-cell--product">
                                                <span className="line-item-cell-label">Product</span>
                                                <div className="line-item-product">
                                                    <input
                                                        ref={el => productInputRefs.current[i] = el}
                                                        value={it.product_name}
                                                        onChange={e => handleProductSearch(i, e.target.value)}
                                                        onKeyDown={e => onProductKeyDown(e, i)}
                                                        onBlur={() => window.setTimeout(() => commitProductMatch(i, it.product_name), 120)}
                                                        placeholder="Type product..."
                                                        style={{ fontSize: '0.82rem' }}
                                                        autoComplete="off"
                                                    />
                                                    {productSuggestions.index === i && productSuggestions.list.length > 0 && (
                                                        <ul className="line-item-suggestions scrollbar">
                                                            {productSuggestions.list.map((p, idx) => (
                                                                <li
                                                                    key={p.id}
                                                                    onMouseDown={() => selectProduct(i, p)}
                                                                    onMouseEnter={() => setProductSuggestions(s => ({ ...s, activeIdx: idx }))}
                                                                    className="line-item-suggestion"
                                                                    style={{ background: idx === productSuggestions.activeIdx ? 'var(--bg-hover)' : 'transparent' }}
                                                                >
                                                                    <span>{p.brand_name ? <strong>{p.brand_name} </strong> : ''}{p.product_name}</span>
                                                                    <span className="badge badge-muted">{p.current_stock}</span>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    )}
                                                </div>
                                                <span className="line-item-secondary">
                                                    {currentProduct ? `Current stock: ${currentProduct.current_stock ?? 0}` : 'Search by product or brand name.'}
                                                </span>
                                            </div>
                                            <div className="line-item-cell">
                                                <span className="line-item-cell-label">Qty</span>
                                                <input
                                                    ref={el => itemRefs.current[i] = el}
                                                    type="number"
                                                    min={1}
                                                    value={it.quantity}
                                                    onChange={e => updateItem(i, 'quantity', +e.target.value)}
                                                    style={{ fontSize: '0.82rem' }}
                                                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (i === items.length - 1) addRow(true); } }}
                                                />
                                            </div>
                                            <div className="line-item-cell">
                                                <span className="line-item-cell-label">Unit Price</span>
                                                <input type="number" min={0} step={0.01} value={it.unit_price} onChange={e => updateItem(i, 'unit_price', +e.target.value)} style={{ fontSize: '0.82rem' }} />
                                            </div>
                                            <div className="line-item-cell">
                                                <span className="line-item-cell-label">GST</span>
                                                <select value={it.gst_percent} onChange={e => updateItem(i, 'gst_percent', +e.target.value)} onKeyDown={e => onTaxFieldKeyDown(e, i)} style={{ fontSize: '0.82rem', padding: '0.4rem 0.5rem' }}>
                                                    {[0, 5, 12, 18, 28].map(r => <option key={r} value={r}>{r}%</option>)}
                                                </select>
                                            </div>
                                            <div className="line-item-cell line-item-cell--amount">
                                                <span className="line-item-cell-label">Amount</span>
                                                <div className="line-item-amount-box">
                                                    <span className="line-item-total">{`₹${it.line_total.toFixed(2)}`}</span>
                                                </div>
                                            </div>
                                            <div className="line-item-cell line-item-cell--action">
                                                <span className="line-item-cell-label">Remove</span>
                                                <div className="line-item-action-box">
                                                    <button className="btn-icon line-item-remove" onClick={() => removeRow(i)} disabled={items.length === 1} style={{ opacity: items.length === 1 ? 0.3 : 1 }}>
                                                        <Trash2 size={13} color="var(--danger)" />
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    <div className="entry-sidebar entry-sticky">
                        <div className="surface summary-card">
                            <p className="summary-title">Invoice Summary</p>
                            <div className="summary-grid">
                                <div className="summary-row"><span>Mapped Items</span><span>{items.filter(it => it.product_id).length}</span></div>
                                <div className="summary-row"><span>Total Qty</span><span>{totalQuantity}</span></div>
                                <div className="summary-row"><span>Price Type</span><span>{priceIncludesTax ? 'Inclusive' : 'Exclusive'}</span></div>
                                <div className="summary-row summary-row--total">
                                    <span>Grand Total</span>
                                    <span style={{ color: 'var(--accent)' }}>{`₹${totalAmount.toFixed(2)}`}</span>
                                </div>
                            </div>
                            <div className="summary-note">The summary only stays beside the form on roomy screens. On tighter layouts it stacks below to protect line-item width.</div>
                            <div className="summary-actions">
                                <button className="btn btn-primary" style={{ justifyContent: 'center' }} onClick={saveInvoice} disabled={saving}>
                                    <Save size={15} /> {saving ? 'Saving...' : 'Save Invoice'} <kbd className="kbd" style={{ marginLeft: '0.25rem' }}>Alt+Enter</kbd>
                                </button>
                            </div>
                        </div>

                        <div className="surface shortcut-panel">
                            <p style={{ marginBottom: '0.3rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Keyboard shortcuts</p>
                            <p><kbd className="kbd">Tab</kbd> - move between fields and pick suggestions</p>
                            <p style={{ marginTop: '0.2rem' }}><kbd className="kbd">Alt+N</kbd> - add item row</p>
                            <p style={{ marginTop: '0.2rem' }}><kbd className="kbd">Alt+Enter</kbd> - save invoice</p>
                        </div>
                    </div>
                </div>
            )}
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
