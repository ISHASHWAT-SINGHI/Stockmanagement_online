import { useEffect, useState, useCallback, useRef } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Pencil, Archive, ArchiveRestore, Package } from 'lucide-react';
import { getProducts, createProduct, updateProduct, archiveProduct, unarchiveProduct } from '../api';
import { useKeyboardShortcut } from '../hooks/useKeyboard';
import { useToast } from '../hooks/useToast';
import Modal from '../components/Modal';
import { getStockBatchesForProduct, adjustStock } from '../api';

const empty = { brand_name: '', product_name: '', packing_type: 'Unit', units_per_pack: 1, current_stock: 0 };

export default function Products() {
    const { searchQuery } = useOutletContext();
    const { addToast } = useToast();
    const [products, setProducts] = useState([]);
    const [showArchived, setShowArchived] = useState(false);
    const [loading, setLoading] = useState(true);
    const [modal, setModal] = useState(null); // null | 'add' | 'edit' | 'adjust'
    const [form, setForm] = useState(empty);
    const [editing, setEditing] = useState(null);
    const [saving, setSaving] = useState(false);

    // Adjust stock state
    const [adjustProduct, setAdjustProduct] = useState(null);
    const [batches, setBatches] = useState([]);
    const [adjustForm, setAdjustForm] = useState({ stock_batch_id: '', adjustment_type: 'CORRECTION', quantity: '', reason: '' });

    const firstRef = useRef(null);

    const load = useCallback(async () => {
        try { const r = await getProducts(showArchived); setProducts(r.data); }
        catch { addToast('Failed to load products', 'error'); }
        finally { setLoading(false); }
    }, [addToast, showArchived]);

    useEffect(() => { load(); }, [load]);

    useKeyboardShortcut('n', () => openAdd());

    const openAdd = () => { setForm(empty); setEditing(null); setModal('add'); };
    const openEdit = (p) => { setForm({ ...p }); setEditing(p.id); setModal('edit'); };

    const openAdjust = async (p) => {
        setAdjustProduct(p);
        setAdjustForm({ stock_batch_id: '', adjustment_type: 'CORRECTION', quantity: '', reason: '' });
        setModal('adjust');
        try {
            const res = await getStockBatchesForProduct(p.id);
            setBatches(res.data);
            if (res.data.length > 0) setAdjustForm(f => ({ ...f, stock_batch_id: res.data[0].id }));
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
            closeModal(); load();
        } catch { addToast('Save failed', 'error'); }
        finally { setSaving(false); }
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
                reason: adjustForm.reason
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

    const filtered = products.filter(p =>
        !searchQuery || [p.product_name, p.brand_name].some(v => v?.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    const stockBadge = (n) => {
        if (n === 0) return <span className="badge badge-danger">Out</span>;
        if (n <= 5) return <span className="badge badge-warning">{n}</span>;
        return <span className="badge badge-success">{n}</span>;
    };

    return (
        <>
            <div className="page-header">
                <h2 className="page-title">Products</h2>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button className={`btn btn-sm ${showArchived ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setShowArchived(!showArchived)}>
                        {showArchived ? 'Hide Archived' : 'Show Archived'}
                    </button>
                    <button className="btn btn-primary" onClick={openAdd}>
                        <Plus size={15} /> New Product <kbd className="kbd" style={{ marginLeft: '0.25rem' }}>Alt+N</kbd>
                    </button>
                </div>
            </div>

            <div className="surface" style={{ overflow: 'hidden' }}>
                {loading ? (
                    <div style={{ padding: '1.5rem' }}>
                        {[...Array(5)].map((_, i) => <div key={i} className="skeleton" style={{ height: 40, marginBottom: 6 }} />)}
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="empty-state"><Package size={36} /><span>{searchQuery ? 'No matching products' : 'No products yet — press Alt+N to add one'}</span></div>
                ) : (
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Product Name</th>
                                <th>Brand</th>
                                <th>Packing</th>
                                <th>Units/Pack</th>
                                <th style={{ textAlign: 'right' }}>Stock</th>
                                <th style={{ textAlign: 'right' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map((p, i) => (
                                <tr key={p.id}>
                                    <td style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{i + 1}</td>
                                    <td style={{ fontWeight: 500 }}>{p.product_name}</td>
                                    <td style={{ color: 'var(--text-muted)' }}>{p.brand_name || '—'}</td>
                                    <td><span className="badge badge-muted">{p.packing_type}</span></td>
                                    <td style={{ color: 'var(--text-secondary)' }}>{p.units_per_pack}</td>
                                    <td style={{ textAlign: 'right' }}>{stockBadge(p.current_stock)}</td>
                                    <td style={{ textAlign: 'right' }}>
                                        <div style={{ display: 'flex', gap: '0.25rem', justifyContent: 'flex-end' }}>
                                            <button className="btn-icon" onClick={() => openAdjust(p)} title="Adjust Stock">
                                                <Package size={14} />
                                            </button>
                                            <button className="btn-icon" onClick={() => openEdit(p)} title="Edit">
                                                <Pencil size={14} />
                                            </button>
                                            {p.is_archived ? (
                                                <button className="btn-icon" onClick={() => unarchive(p.id, p.product_name)} title="Unarchive" style={{ color: 'var(--success)' }}>
                                                    <ArchiveRestore size={14} />
                                                </button>
                                            ) : (
                                                <button className="btn-icon btn-danger" onClick={() => archive(p.id, p.product_name)} title="Archive">
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

            {modal && (
                <Modal
                    title={editing ? 'Edit Product' : 'Add Product'}
                    onClose={closeModal}
                    footer={
                        <>
                            <button className="btn btn-ghost btn-sm" onClick={closeModal}>Cancel</button>
                            <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
                                {saving ? 'Saving…' : editing ? 'Update' : 'Add Product'}
                            </button>
                        </>
                    }
                >
                    <div style={{ display: 'grid', gap: '0.9rem' }}>
                        <div className="form-group">
                            <label className="form-label">Product Name *</label>
                            <input ref={firstRef} value={form.product_name} onChange={e => setForm(f => ({ ...f, product_name: e.target.value }))}
                                placeholder="e.g. Paracetamol 500mg"
                                onKeyDown={e => e.key === 'Enter' && save()} />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Brand / Manufacturer</label>
                            <input value={form.brand_name} onChange={e => setForm(f => ({ ...f, brand_name: e.target.value }))}
                                placeholder="e.g. Sun Pharma" onKeyDown={e => e.key === 'Enter' && save()} />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                            <div className="form-group">
                                <label className="form-label">Packing Type</label>
                                <input list="packing_types" value={form.packing_type} onChange={e => setForm(f => ({ ...f, packing_type: e.target.value }))} placeholder="e.g. Box, Unit" onKeyDown={e => e.key === 'Enter' && save()} />
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
                                <input type="number" min={1} value={form.units_per_pack}
                                    onChange={e => setForm(f => ({ ...f, units_per_pack: +e.target.value }))}
                                    onKeyDown={e => e.key === 'Enter' && save()} />
                            </div>
                        </div>
                    </div>
                </Modal>
            )}

            {modal === 'adjust' && adjustProduct && (
                <Modal
                    title={`Adjust Stock: ${adjustProduct.product_name}`}
                    onClose={closeModal}
                    footer={
                        <>
                            <button className="btn btn-ghost btn-sm" onClick={closeModal}>Cancel</button>
                            <button className="btn btn-primary btn-sm" onClick={submitAdjust} disabled={saving}>
                                {saving ? 'Applying...' : 'Apply Adjustment'}
                            </button>
                        </>
                    }
                >
                    <div style={{ display: 'grid', gap: '1rem' }}>
                        <div className="alert alert-warning" style={{ margin: 0 }}>
                            Use this to manually correct stock counts due to damage, expiry, or counting errors.
                            <strong> Negative</strong> numbers reduce stock. <strong>Positive</strong> numbers add stock.
                        </div>

                        <div className="form-group">
                            <label className="form-label">Select Batch</label>
                            <select
                                value={adjustForm.stock_batch_id}
                                onChange={e => setAdjustForm(f => ({ ...f, stock_batch_id: Number(e.target.value) }))}
                            >
                                <option value="">-- Select Batch --</option>
                                {batches.map(b => (
                                    <option key={b.id} value={b.id}>
                                        Batch #{b.id} (Available: {b.available_quantity}) - {b.purchase_date}
                                    </option>
                                ))}
                            </select>
                            {batches.length === 0 && <span className="help-text" style={{ color: 'var(--danger-text)' }}>No batches available to adjust.</span>}
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                            <div className="form-group">
                                <label className="form-label">Type</label>
                                <select value={adjustForm.adjustment_type} onChange={e => setAdjustForm(f => ({ ...f, adjustment_type: e.target.value }))}>
                                    <option value="CORRECTION">Correction (Count Mismatch)</option>
                                    <option value="DAMAGE">Damage</option>
                                    <option value="EXPIRY">Expiry</option>
                                    <option value="RETURN">Return / Found</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Quantity (+/-)</label>
                                <input type="number" value={adjustForm.quantity} placeholder="-5 or +2"
                                    onChange={e => setAdjustForm(f => ({ ...f, quantity: e.target.value }))}
                                    onKeyDown={e => e.key === 'Enter' && submitAdjust()} />
                            </div>
                        </div>

                        <div className="form-group">
                            <label className="form-label">Reason / Notes</label>
                            <input value={adjustForm.reason} placeholder="e.g. 2 boxes damaged during transit"
                                onChange={e => setAdjustForm(f => ({ ...f, reason: e.target.value }))}
                                onKeyDown={e => e.key === 'Enter' && submitAdjust()} />
                        </div>
                    </div>
                </Modal>
            )}
        </>
    );
}
