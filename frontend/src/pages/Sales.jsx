import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle, Eye, Pencil, Plus, Printer, Save, ShoppingCart, Trash2 } from 'lucide-react';
import { createSale, getBusinessSettings, getCustomers, getProducts, getSale, getSales, updateSale } from '../api';
import { useKeyboardShortcut } from '../hooks/useKeyboard';
import { useToast } from '../hooks/useToast';
import Modal from '../components/Modal';

const GST_RATES = [0, 5, 12, 18, 28];

function emptyItem() {
    return {
        product_id: '',
        product_name: '',
        quantity: 1,
        selling_price: 0,
        gst_percent: 12,
        discount_percent: 0,
        final_amount: 0,
        available: 0,
    };
}

function normalizeText(value = '') {
    return value.toLowerCase().trim().replace(/\s+/g, ' ');
}

function getProductDisplayName(product) {
    return [product?.brand_name, product?.product_name].filter(Boolean).join(' ');
}

function getSaleItemDisplayName(item) {
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

function calcItem(item) {
    const base = item.selling_price * item.quantity;
    const afterDiscount = base - (base * item.discount_percent / 100);
    const gstAmount = afterDiscount * item.gst_percent / 100;
    return { ...item, final_amount: +(afterDiscount + gstAmount).toFixed(2) };
}

function calcBill(items, discountAmt, isDiscountPercent) {
    const subtotal = items.reduce((sum, item) => sum + (item.selling_price * item.quantity), 0);
    const taxable = items.reduce((sum, item) => (
        sum + item.selling_price * item.quantity * (1 - item.discount_percent / 100)
    ), 0);
    const gstTotal = items.reduce((sum, item) => (
        sum + item.selling_price * item.quantity * (1 - item.discount_percent / 100) * item.gst_percent / 100
    ), 0);
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
        extraDiscountValue: +extraDiscountValue.toFixed(2),
    };
}

function getTodayInputValue() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatInputDate(value) {
    const date = new Date(value);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getTotalQuantity(items = []) {
    return items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
}

function getApiErrorMessage(error, fallback) {
    return error?.response?.data?.detail || error?.message || fallback;
}

export default function Sales() {
    const { addToast } = useToast();
    const [products, setProducts] = useState([]);
    const [customers, setCustomers] = useState([]);
    const [bills, setBills] = useState([]);
    const [view, setView] = useState('new');
    const [editingBillId, setEditingBillId] = useState(null);

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
        const [productsResult, customersResult, salesResult, settingsResult] = await Promise.allSettled([
            getProducts(),
            getCustomers(),
            getSales(),
            getBusinessSettings(),
        ]);

        if (productsResult.status === 'fulfilled') {
            setProducts(productsResult.value.data);
        } else {
            addToast(getApiErrorMessage(productsResult.reason, 'Failed to load products'), 'error');
        }

        if (customersResult.status === 'fulfilled') {
            setCustomers(customersResult.value.data);
        } else {
            addToast(getApiErrorMessage(customersResult.reason, 'Failed to load customers'), 'error');
        }

        if (salesResult.status === 'fulfilled') {
            setBills(salesResult.value.data);
        } else {
            addToast(getApiErrorMessage(salesResult.reason, 'Failed to load bill history'), 'error');
        }

        if (settingsResult.status === 'fulfilled') {
            setSettings(settingsResult.value.data);
        } else {
            addToast(getApiErrorMessage(settingsResult.reason, 'Failed to load business settings'), 'error');
        }
    }, [addToast]);

    useEffect(() => {
        load();
    }, [load]);

    const resetBillForm = useCallback(() => {
        setEditingBillId(null);
        setCustomerId('');
        setCustomerSearch('');
        setBillDate(getTodayInputValue());
        setItems([emptyItem()]);
        setDiscountAmt(0);
        setIsDiscountPercent(false);
        setPaymentMode('Cash');
        setPaidAmt('');
        setProductSuggestions({ index: null, list: [], activeIdx: -1 });
        setCustomerSuggestions([]);
        setCustomerSuggestIndex(-1);
    }, []);

    useKeyboardShortcut('n', () => addRow(true), { alt: true, allowInInput: true });

    const focusProductInputAt = (index) => {
        window.setTimeout(() => productInputRefs.current[index]?.focus(), 0);
    };

    const addRow = (focusProduct = false) => {
        const nextIndex = items.length;
        setItems(prev => [...prev, emptyItem()]);
        if (focusProduct) focusProductInputAt(nextIndex);
    };

    const removeRow = (index) => {
        setItems(prev => prev.filter((_, itemIndex) => itemIndex !== index));
    };

    const updateItem = (index, field, value) => {
        setItems(prev => {
            const next = [...prev];
            next[index] = calcItem({ ...next[index], [field]: value });
            return next;
        });
    };

    const handleProductSearch = (index, value) => {
        setItems(prev => {
            const next = [...prev];
            next[index] = calcItem({
                ...next[index],
                product_name: value,
                product_id: '',
                available: 0,
            });
            return next;
        });
        if (value.length < 2) {
            setProductSuggestions({ index: null, list: [], activeIdx: -1 });
            return;
        }
        const list = products.filter(product => matchesProductSearch(product, value)).slice(0, 8);
        setProductSuggestions({ index, list, activeIdx: -1 });
    };

    const applyProductSelection = (index, product, focusQuantity = true) => {
        setProductSuggestions({ index: null, list: [], activeIdx: -1 });
        setItems(prev => {
            const next = [...prev];
            next[index] = calcItem({
                ...next[index],
                product_id: product.id,
                product_name: getProductDisplayName(product),
                available: product.current_stock || 0,
            });
            return next;
        });
        if (focusQuantity) {
            window.setTimeout(() => itemRefs.current[index]?.focus(), 50);
        }
    };

    const commitProductMatch = (index, rawValue) => {
        const exactMatch = findExactProductMatch(products, rawValue);
        if (exactMatch) {
            applyProductSelection(index, exactMatch, false);
        } else if (productSuggestions.index === index) {
            setProductSuggestions({ index: null, list: [], activeIdx: -1 });
        }
    };

    const onProductKeyDown = (event, index) => {
        const { list, activeIdx } = productSuggestions;
        if (productSuggestions.index !== index || list.length === 0) return;

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setProductSuggestions(suggestions => ({
                ...suggestions,
                activeIdx: Math.min(suggestions.activeIdx + 1, list.length - 1),
            }));
            return;
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault();
            setProductSuggestions(suggestions => ({
                ...suggestions,
                activeIdx: Math.max(suggestions.activeIdx - 1, -1),
            }));
            return;
        }

        if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault();
            applyProductSelection(index, activeIdx >= 0 ? list[activeIdx] : list[0], true);
            return;
        }

        if (event.key === 'Escape') {
            setProductSuggestions({ index: null, list: [], activeIdx: -1 });
        }
    };

    const handleCustomerSearch = (value) => {
        setCustomerSearch(value);
        setCustomerId('');
        setCustomerSuggestIndex(-1);
        if (!value) {
            setCustomerSuggestions([]);
            return;
        }
        setCustomerSuggestions(customers.filter(customer => (
            customer.name.toLowerCase().includes(value.toLowerCase()) || (customer.phone || '').includes(value)
        )).slice(0, 6));
    };

    const selectCustomer = (customer) => {
        setCustomerId(customer.id);
        setCustomerSearch(customer.name + (customer.phone ? ` (${customer.phone})` : ''));
        setCustomerSuggestions([]);
    };

    const onCustomerKeyDown = (event) => {
        if (customerSuggestions.length === 0) return;

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setCustomerSuggestIndex(index => Math.min(index + 1, customerSuggestions.length - 1));
            return;
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault();
            setCustomerSuggestIndex(index => Math.max(index - 1, -1));
            return;
        }

        if (event.key === 'Enter' || event.key === 'Tab') {
            if (customerSuggestIndex >= 0 && customerSuggestIndex < customerSuggestions.length) {
                event.preventDefault();
                selectCustomer(customerSuggestions[customerSuggestIndex]);
            } else if (event.key === 'Tab' && customerSuggestions.length > 0) {
                event.preventDefault();
                selectCustomer(customerSuggestions[0]);
            }
            return;
        }

        if (event.key === 'Escape') {
            setCustomerSuggestions([]);
        }
    };

    const openDetails = async (id) => {
        try {
            const response = await getSale(id);
            setSelectedBill(response.data);
        } catch (error) {
            addToast(getApiErrorMessage(error, 'Failed to load bill details'), 'error');
        }
    };

    const resolveItemsForSave = () => {
        const resolved = items.map(item => {
            if (item.product_id || !item.product_name?.trim()) return item;
            const exactMatch = findExactProductMatch(products, item.product_name);
            if (!exactMatch) return item;
            return calcItem({
                ...item,
                product_id: exactMatch.id,
                product_name: getProductDisplayName(exactMatch),
                available: exactMatch.current_stock || 0,
            });
        });
        setItems(resolved);
        return resolved;
    };

    const startEditingBill = (billData) => {
        const linkedCustomer = billData?.customer || customers.find(customer => customer.id === billData?.customer_id) || null;
        const restoredItems = (billData?.sales_items || []).map(item => calcItem({
            ...emptyItem(),
            product_id: item.product_id,
            product_name: getSaleItemDisplayName(item),
            quantity: item.quantity,
            selling_price: item.selling_price,
            gst_percent: item.gst_percent,
            discount_percent: item.discount_percent,
            available: products.find(product => product.id === item.product_id)?.current_stock || 0,
        }));

        setEditingBillId(billData.id);
        setCustomerId(billData.customer_id || '');
        setCustomerSearch(linkedCustomer ? linkedCustomer.name + (linkedCustomer.phone ? ` (${linkedCustomer.phone})` : '') : '');
        setBillDate(formatInputDate(billData.bill_date));
        setItems(restoredItems.length > 0 ? restoredItems : [emptyItem()]);
        setDiscountAmt(billData.discount_amount || 0);
        setIsDiscountPercent(false);
        setPaymentMode(billData.payment_mode || 'Cash');
        setPaidAmt(billData.paid_amount != null ? String(billData.paid_amount) : '');
        setSelectedBill(null);
        setView('new');
        setProductSuggestions({ index: null, list: [], activeIdx: -1 });
        setCustomerSuggestions([]);
        setCustomerSuggestIndex(-1);
        window.setTimeout(() => productInputRefs.current[0]?.focus(), 0);
    };

    const onLastEditableFieldKeyDown = (event, index) => {
        if (event.key === 'Tab' && !event.shiftKey && index === items.length - 1) {
            event.preventDefault();
            addRow(true);
        }
    };

    const totals = calcBill(items.filter(item => item.product_id), discountAmt, isDiscountPercent);
    const totalQuantity = getTotalQuantity(items.filter(item => item.product_id));

    const saveBill = async () => {
        const preparedItems = resolveItemsForSave();
        const unresolvedItems = preparedItems.filter(item => item.product_name?.trim() && !item.product_id);
        if (unresolvedItems.length > 0) {
            addToast('Choose products from the suggestion list or type an exact product name.', 'error');
            return;
        }

        const validItems = preparedItems.filter(item => item.product_id && item.quantity > 0);
        if (validItems.length === 0) {
            addToast('Add at least one product with stock', 'error');
            return;
        }

        const billTotals = calcBill(validItems, discountAmt, isDiscountPercent);
        const paid = paidAmt === '' ? billTotals.grand : parseFloat(paidAmt);
        const outstanding = Math.max(0, billTotals.grand - paid);
        const payload = {
            customer_id: customerId || null,
            ...(billDate ? { bill_date: billDate } : {}),
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
            items: validItems.map(item => ({
                product_id: item.product_id,
                quantity: item.quantity,
                selling_price: item.selling_price,
                gst_percent: item.gst_percent,
                discount_percent: item.discount_percent,
                final_amount: item.final_amount,
            })),
        };

        setSaving(true);
        try {
            const response = editingBillId
                ? await updateSale(editingBillId, payload)
                : await createSale(payload);
            addToast(
                editingBillId
                    ? `Bill ${response.data.bill_number} updated!`
                    : `Bill ${response.data.bill_number} saved!`,
                'success'
            );
            resetBillForm();
            await load();
        } catch (error) {
            addToast(error?.response?.data?.detail || 'Failed to save bill', 'error');
        } finally {
            setSaving(false);
        }
    };

    useEffect(() => {
        const handleShortcut = (event) => {
            if (event.altKey && event.key === 'Enter') {
                saveBill();
            }
        };
        window.addEventListener('keydown', handleShortcut);
        return () => window.removeEventListener('keydown', handleShortcut);
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
    const selectedBillTotalQuantity = selectedBill?.total_quantity ?? getTotalQuantity(selectedBill?.sales_items || []);

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
            <div className="page-header">
                <div style={{ display: 'flex', gap: '0.25rem', background: 'var(--bg-surface)', borderRadius: 10, padding: '0.25rem', border: '1px solid var(--border)' }}>
                    {[['new', ShoppingCart, 'New Bill'], ['history', CheckCircle, 'History']].map(([key, Icon, label]) => (
                        <button
                            key={key}
                            onClick={() => setView(key)}
                            className="btn btn-sm"
                            style={{
                                background: view === key ? 'var(--accent)' : 'transparent',
                                color: view === key ? '#fff' : 'var(--text-muted)',
                            }}
                        >
                            <Icon size={14} /> {label}
                        </button>
                    ))}
                </div>
                {view === 'new' && (
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        {editingBillId && (
                            <button className="btn btn-ghost btn-sm" onClick={resetBillForm}>Cancel Edit</button>
                        )}
                        <button className="btn btn-ghost btn-sm" onClick={() => addRow(true)}><Plus size={14} /> Add Row <kbd className="kbd">Alt+N</kbd></button>
                        <button className="btn btn-primary" onClick={saveBill} disabled={saving}>
                            <Save size={14} /> {saving ? 'Saving…' : editingBillId ? 'Update Bill' : 'Save Bill'} <kbd className="kbd">Alt+↵</kbd>
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
                            <thead>
                                <tr>
                                    <th>Bill No.</th>
                                    <th>Date</th>
                                    <th>Qty</th>
                                    <th>Payment</th>
                                    <th>Status</th>
                                    <th style={{ textAlign: 'right' }}>Total</th>
                                    <th style={{ textAlign: 'right' }}>Paid</th>
                                    <th style={{ textAlign: 'right' }}>Due</th>
                                    <th style={{ textAlign: 'right' }}>Details</th>
                                </tr>
                            </thead>
                            <tbody>
                                {bills.map(bill => (
                                    <tr key={bill.id} style={{ cursor: 'pointer' }} onClick={() => openDetails(bill.id)}>
                                        <td style={{ fontWeight: 600 }}>{bill.bill_number}</td>
                                        <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{formatDisplayDate(bill.bill_date)}</td>
                                        <td>{bill.total_quantity ?? 0}</td>
                                        <td><span className="badge badge-muted">{bill.payment_mode || '—'}</span></td>
                                        <td><span className={`badge ${bill.payment_status === 'Paid' ? 'badge-success' : bill.payment_status === 'Partial' ? 'badge-warning' : 'badge-muted'}`}>{bill.payment_status}</span></td>
                                        <td style={{ textAlign: 'right', fontWeight: 600 }}>₹{bill.grand_total?.toFixed(2)}</td>
                                        <td style={{ textAlign: 'right', color: 'var(--success)' }}>₹{bill.paid_amount?.toFixed(2)}</td>
                                        <td style={{ textAlign: 'right', color: bill.outstanding_amount > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>₹{bill.outstanding_amount?.toFixed(2)}</td>
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
                        <div className="surface" style={{ padding: '1rem', position: 'relative', zIndex: 10 }}>
                            <div className="form-group">
                                <label className="form-label">Customer (optional)</label>
                                <input
                                    value={customerSearch}
                                    onChange={event => handleCustomerSearch(event.target.value)}
                                    onKeyDown={onCustomerKeyDown}
                                    placeholder="Search by name or phone…"
                                    autoComplete="off"
                                />
                            </div>
                            {customerSuggestions.length > 0 && (
                                <ul style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '8px', zIndex: 50, listStyle: 'none', margin: '2px 0' }}>
                                    {customerSuggestions.map((customer, index) => (
                                        <li
                                            key={customer.id}
                                            onMouseDown={() => selectCustomer(customer)}
                                            onMouseEnter={() => setCustomerSuggestIndex(index)}
                                            style={{
                                                padding: '0.6rem 1rem',
                                                cursor: 'pointer',
                                                fontSize: '0.85rem',
                                                background: index === customerSuggestIndex ? 'var(--bg-hover)' : 'transparent',
                                            }}
                                        >
                                            <strong>{customer.name}</strong>
                                            {customer.phone && <span style={{ color: 'var(--text-muted)', marginLeft: '0.5rem' }}>{customer.phone}</span>}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>

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
                                            <th style={{ width: 40 }} />
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {items.map((item, index) => (
                                            <tr key={index}>
                                                <td style={{ position: 'relative' }}>
                                                    <input
                                                        ref={element => { productInputRefs.current[index] = element; }}
                                                        value={item.product_name}
                                                        onChange={event => handleProductSearch(index, event.target.value)}
                                                        onKeyDown={event => onProductKeyDown(event, index)}
                                                        onBlur={() => window.setTimeout(() => commitProductMatch(index, item.product_name), 120)}
                                                        placeholder="Type product name…"
                                                        style={{ fontSize: '0.82rem' }}
                                                        autoComplete="off"
                                                    />
                                                    {productSuggestions.index === index && productSuggestions.list.length > 0 && (
                                                        <ul style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '8px', zIndex: 100, listStyle: 'none', margin: '2px 0', maxHeight: 200, overflowY: 'auto' }}>
                                                            {productSuggestions.list.map((product, suggestionIndex) => (
                                                                <li
                                                                    key={product.id}
                                                                    onMouseDown={() => applyProductSelection(index, product)}
                                                                    onMouseEnter={() => setProductSuggestions(suggestions => ({ ...suggestions, activeIdx: suggestionIndex }))}
                                                                    style={{
                                                                        padding: '0.55rem 0.85rem',
                                                                        cursor: 'pointer',
                                                                        fontSize: '0.82rem',
                                                                        display: 'flex',
                                                                        justifyContent: 'space-between',
                                                                        background: suggestionIndex === productSuggestions.activeIdx ? 'var(--bg-hover)' : 'transparent',
                                                                    }}
                                                                >
                                                                    <span>{product.brand_name ? <strong>{product.brand_name} </strong> : ''}{product.product_name}</span>
                                                                    <span className={`badge ${product.current_stock < 5 ? 'badge-warning' : 'badge-muted'}`}>{product.current_stock}</span>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    )}
                                                </td>
                                                <td>
                                                    <input
                                                        ref={element => { itemRefs.current[index] = element; }}
                                                        type="number"
                                                        min={1}
                                                        value={item.quantity}
                                                        onChange={event => updateItem(index, 'quantity', +event.target.value)}
                                                        style={{ fontSize: '0.82rem' }}
                                                        onKeyDown={event => {
                                                            if (event.key === 'Enter') {
                                                                event.preventDefault();
                                                                if (index === items.length - 1) addRow(true);
                                                            }
                                                        }}
                                                    />
                                                </td>
                                                <td>
                                                    <input type="number" min={0} step={0.01} value={item.selling_price} onChange={event => updateItem(index, 'selling_price', +event.target.value)} style={{ fontSize: '0.82rem' }} />
                                                </td>
                                                <td>
                                                    <select value={item.gst_percent} onChange={event => updateItem(index, 'gst_percent', +event.target.value)} style={{ fontSize: '0.82rem', padding: '0.4rem 0.5rem' }}>
                                                        {GST_RATES.map(rate => <option key={rate} value={rate}>{rate}%</option>)}
                                                    </select>
                                                </td>
                                                <td>
                                                    <input type="number" min={0} max={100} value={item.discount_percent} onChange={event => updateItem(index, 'discount_percent', +event.target.value)} onKeyDown={event => onLastEditableFieldKeyDown(event, index)} style={{ fontSize: '0.82rem' }} />
                                                </td>
                                                <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                                                    ₹{item.final_amount.toFixed(2)}
                                                </td>
                                                <td>
                                                    <button className="btn-icon" onClick={() => removeRow(index)} title="Remove row" style={{ opacity: items.length === 1 ? 0.3 : 1 }} disabled={items.length === 1}>
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

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', position: 'sticky', top: 0 }}>
                        <div className="surface" style={{ padding: '1.25rem' }}>
                            <div className="form-group" style={{ marginBottom: '1rem' }}>
                                <label className="form-label">Bill Date</label>
                                <input type="date" value={billDate} onChange={event => setBillDate(event.target.value)} />
                            </div>
                            {editingBillId && (
                                <div style={{ marginBottom: '1rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                                    Editing an existing bill. The bill number stays the same and a new revision is saved.
                                </div>
                            )}
                            <p style={{ fontWeight: 700, marginBottom: '1rem', fontSize: '0.9rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Bill Summary</p>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.875rem' }}>
                                {[
                                    ['Total Qty', totalQuantity],
                                    ['Subtotal', `₹${totals.subtotal.toFixed(2)}`],
                                    ['Extra Discount', `-₹${totals.extraDiscountValue.toFixed(2)}`],
                                    ['Taxable', `₹${totals.taxable.toFixed(2)}`],
                                    ['CGST', `₹${totals.cgst.toFixed(2)}`],
                                    ['SGST', `₹${totals.sgst.toFixed(2)}`],
                                ].map(([label, value]) => (
                                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)' }}>
                                        <span>{label}</span><span>{value}</span>
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

                            <div className="form-group" style={{ marginTop: '1rem' }}>
                                <label className="form-label">Extra Discount</label>
                                <div style={{ display: 'flex', gap: '0.4rem' }}>
                                    <input type="number" min={0} value={discountAmt} onChange={event => setDiscountAmt(+event.target.value)} style={{ flex: 1 }} />
                                    <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden' }}>
                                        <button className="btn btn-sm" onClick={event => { event.preventDefault(); setIsDiscountPercent(false); }} style={{ borderRadius: 0, padding: '0 0.5rem', background: !isDiscountPercent ? 'var(--accent)' : 'var(--bg-elevated)', color: !isDiscountPercent ? '#fff' : 'var(--text-muted)' }}>₹</button>
                                        <button className="btn btn-sm" onClick={event => { event.preventDefault(); setIsDiscountPercent(true); }} style={{ borderRadius: 0, padding: '0 0.5rem', background: isDiscountPercent ? 'var(--accent)' : 'var(--bg-elevated)', color: isDiscountPercent ? '#fff' : 'var(--text-muted)' }}>%</button>
                                    </div>
                                </div>
                            </div>

                            <div style={{ marginTop: '1rem' }}>
                                <p className="form-label" style={{ marginBottom: '0.4rem' }}>Payment Mode</p>
                                <div style={{ display: 'flex', gap: '0.4rem' }}>
                                    {['Cash', 'UPI', 'Credit'].map(mode => (
                                        <button
                                            key={mode}
                                            onClick={() => setPaymentMode(mode)}
                                            className="btn btn-sm"
                                            style={{
                                                flex: 1,
                                                background: paymentMode === mode ? 'var(--accent)' : 'var(--bg-elevated)',
                                                color: paymentMode === mode ? '#fff' : 'var(--text-muted)',
                                                border: `1px solid ${paymentMode === mode ? 'var(--accent)' : 'var(--border)'}`,
                                            }}
                                        >
                                            {mode}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="form-group" style={{ marginTop: '0.75rem' }}>
                                <label className="form-label">Paid Amount (₹)</label>
                                <input type="number" min={0} value={paidAmt} onChange={event => setPaidAmt(event.target.value)} placeholder={totals.grand.toFixed(2)} />
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
                                <Save size={15} /> {saving ? 'Saving…' : editingBillId ? 'Update Bill' : 'Save Bill'} <kbd className="kbd" style={{ marginLeft: '0.25rem' }}>Alt+↵</kbd>
                            </button>
                        </div>

                        <div className="surface" style={{ padding: '0.75rem 1rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            <p style={{ marginBottom: '0.3rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Keyboard shortcuts</p>
                            <p><kbd className="kbd">Tab</kbd> - move between fields / select item</p>
                            <p style={{ marginTop: '0.2rem' }}><kbd className="kbd">Alt+N</kbd> - add item row</p>
                            <p style={{ marginTop: '0.2rem' }}><kbd className="kbd">Enter</kbd> on last qty - new row</p>
                            <p style={{ marginTop: '0.2rem' }}><kbd className="kbd">Alt+↵</kbd> - save bill</p>
                        </div>
                    </div>
                </div>
            )}

            {selectedBill && (
                <Modal
                    title={`Bill Details: ${selectedBill.bill_number}`}
                    onClose={() => setSelectedBill(null)}
                    footer={(
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button className="btn btn-ghost" onClick={() => startEditingBill(selectedBill)}><Pencil size={15} /> Edit</button>
                            <button className="btn btn-primary" onClick={handlePrint}><Printer size={15} /> Print</button>
                            <button className="btn btn-ghost" onClick={() => setSelectedBill(null)}>Close</button>
                        </div>
                    )}
                >
                    <div className="no-print">
                        <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                            <div>
                                <strong>Customer:</strong> {printCustomer?.name || 'Walk-in Customer'}
                                {printCustomer?.address ? `, ${printCustomer.address}` : ''}
                            </div>
                            <div>
                                <strong>Date:</strong> {formatDisplayDate(selectedBill.bill_date)}
                                {selectedBill.revision_number > 1 ? ` | Revision ${selectedBill.revision_number}` : ''}
                            </div>
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
                                {selectedBill.sales_items?.map(item => (
                                    <tr key={item.id}>
                                        <td>{getSaleItemDisplayName(item)}</td>
                                        <td>{item.quantity}</td>
                                        <td>₹{item.selling_price.toFixed(2)}</td>
                                        <td>{item.discount_percent}%</td>
                                        <td>{item.gst_percent}%</td>
                                        <td style={{ textAlign: 'right', fontWeight: 600 }}>₹{item.final_amount.toFixed(2)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', fontSize: '0.9rem', gap: '0.3rem' }}>
                            <div>Total Qty: {selectedBillTotalQuantity}</div>
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
                                <div>Total Qty: {selectedBillTotalQuantity}</div>
                                {selectedBill.revision_number > 1 && <div>Revision: {selectedBill.revision_number}</div>}
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
                                {selectedBill.sales_items?.map((item, index) => (
                                    <tr key={item.id}>
                                        <td style={{ padding: '5px 7px', border: '1px solid #ccc', verticalAlign: 'top' }}>{index + 1}</td>
                                        <td style={{ padding: '5px 7px', border: '1px solid #ccc' }}>
                                            {getSaleItemDisplayName(item)}
                                            <div style={{ fontSize: '10px', color: '#555', marginTop: '2px' }}>
                                                HSN: - | GST: {item.gst_percent}% | Disc: {item.discount_percent}%
                                            </div>
                                        </td>
                                        <td style={{ padding: '5px 7px', border: '1px solid #ccc', textAlign: 'center', verticalAlign: 'top' }}>{item.quantity}</td>
                                        <td style={{ padding: '5px 7px', border: '1px solid #ccc', textAlign: 'right', verticalAlign: 'top' }}>{item.selling_price.toFixed(2)}</td>
                                        <td style={{ padding: '5px 7px', border: '1px solid #ccc', textAlign: 'right', verticalAlign: 'top' }}>{item.final_amount.toFixed(2)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <table style={{ width: '300px', borderCollapse: 'collapse' }}>
                                <tbody>
                                    <tr>
                                        <td style={{ padding: '5px 6px', textAlign: 'right' }}>Total Qty:</td>
                                        <td style={{ padding: '5px 6px', textAlign: 'right', fontWeight: 'bold' }}>{selectedBillTotalQuantity}</td>
                                    </tr>
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
