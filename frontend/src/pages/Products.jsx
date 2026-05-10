import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Plus, Pencil, Archive, ArchiveRestore, Package, SlidersHorizontal, X } from 'lucide-react';
import { getProducts, createProduct, updateProduct, archiveProduct, unarchiveProduct, bulkUnarchiveProducts } from '../api';
import { useKeyboardShortcut } from '../hooks/useKeyboard';
import { useToast } from '../hooks/useToast';
import Modal from '../components/Modal';
import { getStockBatchesForProduct, adjustStock } from '../api';

const empty = { brand_name: '', product_name: '', packing_type: 'Unit', units_per_pack: 1, current_stock: 0 };
const defaultFilters = { search: '', brand: '', category: '', stock_status: '', gst_rate: '', sort_by: 'name_asc' };

export default function Products() {
    const { addToast } = useToast();
    const [products, setProducts] = useState([]);
    const [showArchived, setShowArchived] = useState(false);
    const [loading, setLoading] = useState(true);
    const [modal, setModal] = useState(null);
    const [form, setForm] = useState(empty);
    const [editing, setEditing] = useState(null);
    const [saving, setSaving] = useState(false);
    const [selectedArchivedIds, setSelectedArchivedIds] = useState([]);
    const [filters, setFilters] = useState(defaultFilters);
    const [showFilters, setShowFilters] = useState(true);

    const [adjustProduct, setAdjustProduct] = useState(null);
    const [batches, setBatches] = useState([]);
    const [adjustForm, setAdjustForm] = useState({ stock_batch_id: '', adjustment_type: 'CORRECTION', quantity: '', reason: '' });

    const firstRef = useRef(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const response = await getProducts(showArchived, {
                search: filters.search || undefined,
                brand: filters.brand || undefined,
                category: filters.category || undefined,
                stock_status: filters.stock_status || undefined,
                gst_rate: filters.gst_rate || undefined,
                sort_by: filters.sort_by || undefined,
            });
            setProducts(response.data);
        } catch {
            addToast('Failed to load products', 'error');
        } finally {
            setLoading(false);
        }
    }, [addToast, filters, showArchived]);

    useEffect(() => { load(); }, [load]);
    useEffect(() => {
        if (!showArchived) setSelectedArchivedIds([]);
    }, [showArchived]);
    useEffect(() => {
        setSelectedArchivedIds((prev) => prev.filter((id) => products.some((product) => product.id === id && product.is_archived)));
    }, [products]);

    useKeyboardShortcut('n', () => openAdd());

    const openAdd = () => { setForm(empty); setEditing(null); setModal('add'); };
    const openEdit = (product) => { setForm({ ...product }); setEditing(product.id); setModal('edit'); };

    const openAdjust = async (product) => {
        setAdjustProduct(product);
        setAdjustForm({ stock_batch_id: '', adjustment_type: 'CORRECTION', quantity: '', reason: '' });
        setModal('adjust');
        try {
            const response = await getStockBatchesForProduct(product.id);
            setBatches(response.data);
            if (response.data.length > 0) setAdjustForm((current) => ({ ...current, stock_batch_id: response.data[0].id }));
        } catch {
            addToast('Failed to load batches', 'error');
        }
    };

    const closeModal = () => { setModal(null); setForm(empty); setEditing(null); setAdjustProduct(null); };

    const save = async () => {
        if (!form.product_name.trim()) { addToast('Product name is required', 'error'); return; }
        setSaving(true);
        try {
            if (editing) {
                await updateProduct(editing, form);
                addToast('Product updated', 'success');
            } else {
                await createProduct(form);
                addToast('Product added', 'success');
            }
            closeModal();
            load();
        } catch {
            addToast('Save failed', 'error');
        } finally {
            setSaving(false);
        }
    };

    const submitAdjust = async () => {
        if (!adjustForm.stock_batch_id) return addToast('Please select a batch', 'error');
        if (!adjustForm.quantity || Number(adjustForm.quantity) === 0) return addToast('Enter a valid quantity', 'error');

        setSaving(true);
        try {
            await adjustStock({
                product_id: adjustProduct.id,
                stock_batch_id: adjustForm.stock_batch_id,
                adjustment_type: adjustForm.adjustment_type,
                quantity: Number(adjustForm.quantity),
                reason: adjustForm.reason,
            });
            addToast('Stock adjusted successfully', 'success');
            closeModal();
            load();
        } catch (err) {
            addToast(err.response?.data?.detail || 'Adjustment failed', 'error');
        } finally {
            setSaving(false);
        }
    };

    const archive = async (id, name) => {
        if (!window.confirm(`Archive "${name}"?`)) return;
        try { await archiveProduct(id); addToast('Product archived', 'success'); load(); }
        catch (err) { addToast(err.response?.data?.detail || 'Archive failed', 'error'); }
    };

    const unarchive = async (id, name) => {
        if (!window.confirm(`Unarchive "${name}"?`)) return;
        try { await unarchiveProduct(id); addToast('Product unarchived', 'success'); load(); }
        catch (err) { addToast(err.response?.data?.detail || 'Unarchive failed', 'error'); }
    };

    const toggleArchivedSelection = (id) => {
        setSelectedArchivedIds((prev) => prev.includes(id) ? prev.filter((itemId) => itemId !== id) : [...prev, id]);
    };

    const archivedVisibleIds = products.filter((product) => product.is_archived).map((product) => product.id);
    const allArchivedVisibleSelected = archivedVisibleIds.length > 0 && archivedVisibleIds.every((id) => selectedArchivedIds.includes(id));

    const toggleAllArchivedVisible = () => {
        setSelectedArchivedIds((prev) => {
            if (allArchivedVisibleSelected) return prev.filter((id) => !archivedVisibleIds.includes(id));
            return [...new Set([...prev, ...archivedVisibleIds])];
        });
    };

    const bulkUnarchive = async () => {
        if (selectedArchivedIds.length === 0) return;
        if (!window.confirm(`Unarchive ${selectedArchivedIds.length} selected product${selectedArchivedIds.length === 1 ? '' : 's'}?`)) return;
        try {
            const response = await bulkUnarchiveProducts(selectedArchivedIds);
            addToast(response.data?.detail || 'Products unarchived', 'success');
            setSelectedArchivedIds([]);
            load();
        } catch (err) {
            addToast(err.response?.data?.detail || 'Bulk unarchive failed', 'error');
        }
    };

    const stockBadge = (n, minStock = 0) => {
        if (n === 0) return <span className="badge badge-danger">Out</span>;
        if (n <= (minStock > 0 ? minStock : 5)) return <span className="badge badge-warning">{n}</span>;
        return <span className="badge badge-success">{n}</span>;
    };

    const brands = useMemo(() => [...new Set(products.map((product) => product.brand_name).filter(Boolean))].sort(), [products]);
    const categories = useMemo(() => [...new Set(products.map((product) => product.category).filter(Boolean))].sort(), [products]);
    const gstRates = useMemo(() => [...new Set(products.map((product) => product.tax_rate).filter((value) => value !== null && value !== undefined))].sort((a, b) => a - b), [products]);

    const activeFilterChips = [
        filters.search ? { key: 'search', label: `Search: ${filters.search}` } : null,
        filters.brand ? { key: 'brand', label: `Brand: ${filters.brand}` } : null,
        filters.category ? { key: 'category', label: `Category: ${filters.category}` } : null,
        filters.stock_status ? { key: 'stock_status', label: `Stock: ${filters.stock_status.replace('_', ' ')}` } : null,
        filters.gst_rate ? { key: 'gst_rate', label: `GST: ${filters.gst_rate}%` } : null,
    ].filter(Boolean);

    return (
        <>
            <div className="page-header">
                <h2 className="page-title">Products</h2>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {showArchived && archivedVisibleIds.length > 0 && (
                        <button className="btn btn-ghost btn-sm" onClick={bulkUnarchive} disabled={selectedArchivedIds.length === 0}>
                            <ArchiveRestore size={15} /> Unarchive Selected ({selectedArchivedIds.length})
                        </button>
                    )}
                    <button className={`btn btn-sm ${showArchived ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setShowArchived(!showArchived)}>
                        {showArchived ? 'Hide Archived' : 'Show Archived'}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setShowFilters((current) => !current)}>
                        <SlidersHorizontal size={15} /> {showFilters ? 'Hide Filters' : 'Show Filters'}
                    </button>
                    <button className="btn btn-primary" onClick={openAdd}>
                        <Plus size={15} /> New Product <kbd className="kbd" style={{ marginLeft: '0.25rem' }}>Alt+N</kbd>
                    </button>
                </div>
            </div>

            {showFilters && (
                <div className="surface" style={{ padding: '1rem', display: 'grid', gap: '1rem' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 2fr) repeat(4, minmax(150px, 1fr))', gap: '0.85rem' }}>
                        <div className="form-group">
                            <label className="form-label">Search Products</label>
                            <input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Name, brand, or category" />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Brand</label>
                            <select value={filters.brand} onChange={(event) => setFilters((current) => ({ ...current, brand: event.target.value }))}>
                                <option value="">All brands</option>
                                {brands.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
                            </select>
                        </div>
                        <div className="form-group">
                            <label className="form-label">Category</label>
                            <select value={filters.category} onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value }))}>
                                <option value="">All categories</option>
                                {categories.map((category) => <option key={category} value={category}>{category}</option>)}
                            </select>
                        </div>
                        <div className="form-group">
                            <label className="form-label">Stock Status</label>
                            <select value={filters.stock_status} onChange={(event) => setFilters((current) => ({ ...current, stock_status: event.target.value }))}>
                                <option value="">All stock</option>
                                <option value="in_stock">In stock</option>
                                <option value="low_stock">Low stock</option>
                                <option value="out_of_stock">Out of stock</option>
                            </select>
                        </div>
                        <div className="form-group">
                            <label className="form-label">Sort</label>
                            <select value={filters.sort_by} onChange={(event) => setFilters((current) => ({ ...current, sort_by: event.target.value }))}>
                                <option value="name_asc">Name A-Z</option>
                                <option value="name_desc">Name Z-A</option>
                                <option value="stock_asc">Stock low to high</option>
                                <option value="stock_desc">Stock high to low</option>
                                <option value="price_asc">GST low to high</option>
                                <option value="price_desc">GST high to low</option>
                                <option value="recently_added">Recently added</option>
                                <option value="recently_updated">Recently updated</option>
                            </select>
                        </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                            {activeFilterChips.map((chip) => (
                                <span key={chip.key} className="badge badge-muted" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                                    {chip.label}
                                    <button className="btn-icon" onClick={() => setFilters((current) => ({ ...current, [chip.key]: '' }))} style={{ width: 20, height: 20 }}>
                                        <X size={12} />
                                    </button>
                                </span>
                            ))}
                        </div>
                        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'end', flexWrap: 'wrap' }}>
                            <div className="form-group" style={{ minWidth: 140, marginBottom: 0 }}>
                                <label className="form-label">GST Rate</label>
                                <select value={filters.gst_rate} onChange={(event) => setFilters((current) => ({ ...current, gst_rate: event.target.value }))}>
                                    <option value="">All GST</option>
                                    {gstRates.map((rate) => <option key={rate} value={rate}>{rate}%</option>)}
                                </select>
                            </div>
                            <button className="btn btn-ghost btn-sm" onClick={() => setFilters(defaultFilters)}>Clear Filters</button>
                        </div>
                    </div>
                </div>
            )}

            <div className="surface" style={{ overflow: 'hidden' }}>
                {loading ? (
                    <div style={{ padding: '1.5rem' }}>
                        {[...Array(5)].map((_, i) => <div key={i} className="skeleton" style={{ height: 40, marginBottom: 6 }} />)}
                    </div>
                ) : products.length === 0 ? (
                    <div className="empty-state"><Package size={36} /><span>{activeFilterChips.length > 0 ? 'No matching products' : 'No products yet'}</span></div>
                ) : (
                    <table className="data-table">
                        <thead>
                            <tr>
                                {showArchived && (
                                    <th style={{ width: 40, textAlign: 'center' }}>
                                        <input type="checkbox" checked={allArchivedVisibleSelected} onChange={toggleAllArchivedVisible} aria-label="Select all archived products" />
                                    </th>
                                )}
                                <th>#</th>
                                <th>Product Name</th>
                                <th>Brand</th>
                                <th>Category</th>
                                <th>Packing</th>
                                <th>GST</th>
                                <th style={{ textAlign: 'right' }}>Stock</th>
                                <th style={{ textAlign: 'right' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {products.map((product, index) => (
                                <tr key={product.id}>
                                    {showArchived && (
                                        <td style={{ textAlign: 'center' }}>
                                            {product.is_archived ? (
                                                <input type="checkbox" checked={selectedArchivedIds.includes(product.id)} onChange={() => toggleArchivedSelection(product.id)} aria-label={`Select ${product.product_name}`} />
                                            ) : null}
                                        </td>
                                    )}
                                    <td style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{index + 1}</td>
                                    <td style={{ fontWeight: 500 }}>{product.product_name}</td>
                                    <td style={{ color: 'var(--text-muted)' }}>{product.brand_name || '—'}</td>
                                    <td style={{ color: 'var(--text-muted)' }}>{product.category || '—'}</td>
                                    <td><span className="badge badge-muted">{product.packing_type}</span></td>
                                    <td>{product.tax_rate ?? '—'}</td>
                                    <td style={{ textAlign: 'right' }}>{stockBadge(product.current_stock, product.min_stock_level)}</td>
                                    <td style={{ textAlign: 'right' }}>
                                        <div style={{ display: 'flex', gap: '0.25rem', justifyContent: 'flex-end' }}>
                                            <button className="btn-icon" onClick={() => openAdjust(product)} title="Adjust Stock">
                                                <Package size={14} />
                                            </button>
                                            <button className="btn-icon" onClick={() => openEdit(product)} title="Edit">
                                                <Pencil size={14} />
                                            </button>
                                            {product.is_archived ? (
                                                <button className="btn-icon" onClick={() => unarchive(product.id, product.product_name)} title="Unarchive" style={{ color: 'var(--success)' }}>
                                                    <ArchiveRestore size={14} />
                                                </button>
                                            ) : (
                                                <button className="btn-icon btn-danger" onClick={() => archive(product.id, product.product_name)} title="Archive">
                                                    <Archive size={14} />
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {modal && modal !== 'adjust' && (
                <Modal
                    title={editing ? 'Edit Product' : 'Add Product'}
                    onClose={closeModal}
                    footer={(
                        <>
                            <button className="btn btn-ghost btn-sm" onClick={closeModal}>Cancel</button>
                            <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
                                {saving ? 'Saving...' : editing ? 'Update' : 'Add Product'}
                            </button>
                        </>
                    )}
                >
                    <div style={{ display: 'grid', gap: '0.9rem' }}>
                        <div className="form-group">
                            <label className="form-label">Product Name *</label>
                            <input ref={firstRef} value={form.product_name} onChange={(event) => setForm((current) => ({ ...current, product_name: event.target.value }))} placeholder="e.g. Paracetamol 500mg" onKeyDown={(event) => event.key === 'Enter' && save()} />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Brand / Manufacturer</label>
                            <input value={form.brand_name} onChange={(event) => setForm((current) => ({ ...current, brand_name: event.target.value }))} placeholder="e.g. Sun Pharma" onKeyDown={(event) => event.key === 'Enter' && save()} />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                            <div className="form-group">
                                <label className="form-label">Packing Type</label>
                                <input list="packing_types" value={form.packing_type} onChange={(event) => setForm((current) => ({ ...current, packing_type: event.target.value }))} placeholder="e.g. Box, Unit" onKeyDown={(event) => event.key === 'Enter' && save()} />
                                <datalist id="packing_types">
                                    <option value="Unit" />
                                    <option value="Strip" />
                                    <option value="Box" />
                                    <option value="Carton" />
                                    <option value="Bottle" />
                                </datalist>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Units / Pack</label>
                                <input type="number" min={1} value={form.units_per_pack} onChange={(event) => setForm((current) => ({ ...current, units_per_pack: +event.target.value }))} onKeyDown={(event) => event.key === 'Enter' && save()} />
                            </div>
                        </div>
                    </div>
                </Modal>
            )}

            {modal === 'adjust' && adjustProduct && (
                <Modal
                    title={`Adjust Stock: ${adjustProduct.product_name}`}
                    onClose={closeModal}
                    footer={(
                        <>
                            <button className="btn btn-ghost btn-sm" onClick={closeModal}>Cancel</button>
                            <button className="btn btn-primary btn-sm" onClick={submitAdjust} disabled={saving}>
                                {saving ? 'Applying...' : 'Apply Adjustment'}
                            </button>
                        </>
                    )}
                >
                    <div style={{ display: 'grid', gap: '1rem' }}>
                        <div className="form-group">
                            <label className="form-label">Select Batch</label>
                            <select value={adjustForm.stock_batch_id} onChange={(event) => setAdjustForm((current) => ({ ...current, stock_batch_id: Number(event.target.value) }))}>
                                <option value="">-- Select Batch --</option>
                                {batches.map((batch) => (
                                    <option key={batch.id} value={batch.id}>
                                        Batch #{batch.id} (Available: {batch.available_quantity}) - {batch.purchase_date}
                                    </option>
                                ))}
                            </select>
                            {batches.length === 0 && <span className="help-text" style={{ color: 'var(--danger-text)' }}>No batches available to adjust.</span>}
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                            <div className="form-group">
                                <label className="form-label">Type</label>
                                <select value={adjustForm.adjustment_type} onChange={(event) => setAdjustForm((current) => ({ ...current, adjustment_type: event.target.value }))}>
                                    <option value="CORRECTION">Correction</option>
                                    <option value="DAMAGE">Damage</option>
                                    <option value="EXPIRY">Expiry</option>
                                    <option value="RETURN">Return / Found</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Quantity (+/-)</label>
                                <input type="number" value={adjustForm.quantity} placeholder="-5 or +2" onChange={(event) => setAdjustForm((current) => ({ ...current, quantity: event.target.value }))} onKeyDown={(event) => event.key === 'Enter' && submitAdjust()} />
                            </div>
                        </div>

                        <div className="form-group">
                            <label className="form-label">Reason / Notes</label>
                            <input value={adjustForm.reason} placeholder="e.g. 2 boxes damaged during transit" onChange={(event) => setAdjustForm((current) => ({ ...current, reason: event.target.value }))} onKeyDown={(event) => event.key === 'Enter' && submitAdjust()} />
                        </div>
                    </div>
                </Modal>
            )}
        </>
    );
}
