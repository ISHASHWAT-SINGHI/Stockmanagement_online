import { useEffect, useState, useCallback } from 'react';
import { Plus, Users, Building2, Pencil, Eye } from 'lucide-react';
import { getCustomers, createCustomer, updateCustomer, getSuppliers, createSupplier, updateSupplier, getCustomerLedger } from '../api';
import { useKeyboardShortcut } from '../hooks/useKeyboard';
import { useToast } from '../hooks/useToast';
import Modal from '../components/Modal';

const emptyC = { name: '', phone: '', gst_number: '', address: '' };
const emptyS = { company_name: '', phone: '', email: '', gst_number: '', address: '' };

export default function Contacts() {
    const { addToast } = useToast();
    const [searchQuery, setSearchQuery] = useState('');
    const [tab, setTab] = useState('customers');
    const [customers, setCustomers] = useState([]);
    const [suppliers, setSuppliers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [modal, setModal] = useState(null);
    const [form, setForm] = useState(emptyC);
    const [editing, setEditing] = useState(null);
    const [ledger, setLedger] = useState(null);
    const [ledgerModal, setLedgerModal] = useState(false);
    const [saving, setSaving] = useState(false);

    const getApiErrorMessage = (error, fallback) => {
        const message = error?.response?.data?.detail || error?.message || fallback;
        const requestId = error?.response?.headers?.['x-request-id'] || error?.response?.data?.request_id;
        return requestId ? `${message} (Ref: ${requestId})` : message;
    };

    const loadCustomers = useCallback(async () => {
        const r = await getCustomers(); setCustomers(r.data);
    }, []);

    const loadSuppliers = useCallback(async () => {
        const r = await getSuppliers(); setSuppliers(r.data);
    }, []);

    const load = useCallback(async () => {
        setLoading(true);
        const [customersResult, suppliersResult] = await Promise.allSettled([
            loadCustomers(),
            loadSuppliers(),
        ]);

        if (customersResult.status === 'rejected') {
            addToast(getApiErrorMessage(customersResult.reason, 'Failed to load customers'), 'error');
        }

        if (suppliersResult.status === 'rejected') {
            addToast(getApiErrorMessage(suppliersResult.reason, 'Failed to load suppliers'), 'error');
        }

        setLoading(false);
    }, [loadCustomers, loadSuppliers, addToast]);

    useEffect(() => { load(); }, [load]);

    useKeyboardShortcut('n', () => openAdd());

    const isCustomers = tab === 'customers';
    const emptyForm = isCustomers ? emptyC : emptyS;

    const openAdd = () => { setForm(emptyForm); setEditing(null); setModal('form'); };
    const openEdit = (item) => { setForm({ ...item }); setEditing(item.id); setModal('form'); };
    const closeModal = () => { setModal(null); setEditing(null); };

    const openLedger = async (customerId) => {
        try {
            const r = await getCustomerLedger(customerId);
            setLedger(r.data);
            setLedgerModal(true);
        } catch { addToast('Could not load ledger', 'error'); }
    };

    const save = async () => {
        setSaving(true);
        try {
            if (isCustomers) {
                if (!form.name?.trim()) { addToast('Name is required', 'error'); return; }
                if (editing) await updateCustomer(editing, form); else await createCustomer(form);
            } else {
                if (!form.company_name?.trim()) { addToast('Company name is required', 'error'); return; }
                if (!form.gst_number?.trim()) { addToast('GST number is required for suppliers', 'error'); return; }
                if (editing) await updateSupplier(editing, form); else await createSupplier(form);
            }
            addToast(`${isCustomers ? 'Customer' : 'Supplier'} ${editing ? 'updated' : 'added'}`, 'success');
            closeModal(); load();
        } catch { addToast('Save failed', 'error'); }
        finally { setSaving(false); }
    };

    const fCustomers = customers.filter(c => !searchQuery || c.name?.toLowerCase().includes(searchQuery.toLowerCase()) || c.phone?.includes(searchQuery));
    const fSuppliers = suppliers.filter(s => !searchQuery || s.company_name?.toLowerCase().includes(searchQuery.toLowerCase()));

    return (
        <>
            {/* Tab switcher */}
            <div className="page-header">
                <div style={{ display: 'flex', gap: '0.25rem', background: 'var(--bg-surface)', borderRadius: 10, padding: '0.25rem', border: '1px solid var(--border)' }}>
                    {[['customers', Users, 'Customers'], ['suppliers', Building2, 'Suppliers']].map(([key, Icon, label]) => (
                        <button key={key} onClick={() => setTab(key)} className="btn btn-sm" style={{
                            background: tab === key ? 'var(--accent)' : 'transparent',
                            color: tab === key ? '#fff' : 'var(--text-muted)',
                        }}>
                            <Icon size={14} /> {label}
                        </button>
                    ))}
                </div>
                <button className="btn btn-primary" onClick={openAdd}>
                    <Plus size={15} /> {isCustomers ? 'New Customer' : 'New Supplier'} <kbd className="kbd">Alt+N</kbd>
                </button>
            </div>

            <div className="surface" style={{ padding: '1rem' }}>
                <div className="form-group" style={{ maxWidth: 360 }}>
                    <label className="form-label">Search Contacts</label>
                    <input value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Search customers or suppliers" />
                </div>
            </div>

            <div className="surface" style={{ overflow: 'hidden' }}>
                {loading ? (
                    <div style={{ padding: '1.5rem' }}>{[...Array(5)].map((_, i) => <div key={i} className="skeleton" style={{ height: 40, marginBottom: 6 }} />)}</div>
                ) : isCustomers ? (
                    fCustomers.length === 0 ? (
                        <div className="empty-state"><Users size={36} /><span>No customers yet</span></div>
                    ) : (
                        <table className="data-table">
                            <thead><tr><th>#</th><th>Name</th><th>Phone</th><th>GST No.</th><th>Address</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
                            <tbody>
                                {fCustomers.map((c, i) => (
                                    <tr key={c.id}>
                                        <td style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{i + 1}</td>
                                        <td style={{ fontWeight: 500 }}>{c.name}</td>
                                        <td style={{ color: 'var(--text-secondary)' }}>{c.phone || '—'}</td>
                                        <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{c.gst_number || '—'}</td>
                                        <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.address || '—'}</td>
                                        <td style={{ textAlign: 'right' }}>
                                            <div style={{ display: 'flex', gap: '0.25rem', justifyContent: 'flex-end' }}>
                                                <button className="btn-icon" onClick={() => openLedger(c.id)} title="View Ledger"><Eye size={14} /></button>
                                                <button className="btn-icon" onClick={() => openEdit(c)} title="Edit"><Pencil size={14} /></button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )
                ) : (
                    fSuppliers.length === 0 ? (
                        <div className="empty-state"><Building2 size={36} /><span>No suppliers yet</span></div>
                    ) : (
                        <table className="data-table">
                            <thead><tr><th>#</th><th>Company</th><th>Phone</th><th>Email</th><th>GST No.</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
                            <tbody>
                                {fSuppliers.map((s, i) => (
                                    <tr key={s.id}>
                                        <td style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{i + 1}</td>
                                        <td style={{ fontWeight: 500 }}>{s.company_name}</td>
                                        <td style={{ color: 'var(--text-secondary)' }}>{s.phone || '—'}</td>
                                        <td style={{ color: 'var(--text-secondary)' }}>{s.email || '—'}</td>
                                        <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{s.gst_number || '—'}</td>
                                        <td style={{ textAlign: 'right' }}>
                                            <button className="btn-icon" onClick={() => openEdit(s)} title="Edit"><Pencil size={14} /></button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )
                )}
            </div>

            {modal === 'form' && (
                <Modal
                    title={editing ? `Edit ${isCustomers ? 'Customer' : 'Supplier'}` : `Add ${isCustomers ? 'Customer' : 'Supplier'}`}
                    onClose={closeModal}
                    footer={
                        <>
                            <button className="btn btn-ghost btn-sm" onClick={closeModal}>Cancel</button>
                            <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
                        </>
                    }
                >
                    <div style={{ display: 'grid', gap: '0.9rem' }}>
                        {isCustomers ? (
                            <>
                                <div className="form-group"><label className="form-label">Name *</label><input value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Customer name" onKeyDown={e => e.key === 'Enter' && save()} /></div>
                                <div className="form-group"><label className="form-label">Phone</label><input value={form.phone || ''} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="Mobile number" onKeyDown={e => e.key === 'Enter' && save()} /></div>
                                <div className="form-group"><label className="form-label">GST Number</label><input value={form.gst_number || ''} onChange={e => setForm(f => ({ ...f, gst_number: e.target.value }))} placeholder="Optional" onKeyDown={e => e.key === 'Enter' && save()} /></div>
                                <div className="form-group"><label className="form-label">Address</label><input value={form.address || ''} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Optional" onKeyDown={e => e.key === 'Enter' && save()} /></div>
                            </>
                        ) : (
                            <>
                                <div className="form-group"><label className="form-label">Company Name *</label><input value={form.company_name || ''} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} placeholder="Supplier company" onKeyDown={e => e.key === 'Enter' && save()} /></div>
                                <div className="form-group"><label className="form-label">Phone</label><input value={form.phone || ''} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="Contact number" onKeyDown={e => e.key === 'Enter' && save()} /></div>
                                <div className="form-group"><label className="form-label">Email</label><input value={form.email || ''} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="Email address" onKeyDown={e => e.key === 'Enter' && save()} /></div>
                                <div className="form-group"><label className="form-label">GST Number *</label><input value={form.gst_number || ''} onChange={e => setForm(f => ({ ...f, gst_number: e.target.value }))} placeholder="Required" onKeyDown={e => e.key === 'Enter' && save()} /></div>
                                <div className="form-group"><label className="form-label">Address</label><input value={form.address || ''} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Optional" onKeyDown={e => e.key === 'Enter' && save()} /></div>
                            </>
                        )}
                    </div>
                </Modal>
            )}

            {ledgerModal && ledger && (
                <Modal title="Customer Ledger" onClose={() => setLedgerModal(false)}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        {[
                            ['Total Credit', ledger.total_credit, 'var(--info)'],
                            ['Total Paid', ledger.total_paid, 'var(--success)'],
                            ['Outstanding', ledger.outstanding_balance, ledger.outstanding_balance > 0 ? 'var(--danger)' : 'var(--text-muted)'],
                        ].map(([label, val, color]) => (
                            <div key={label} style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: '1rem', border: '1px solid var(--border)' }}>
                                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.3rem' }}>{label}</p>
                                <p style={{ fontSize: '1.4rem', fontWeight: 700, color }}>₹{val?.toFixed(2)}</p>
                            </div>
                        ))}
                    </div>
                </Modal>
            )}
        </>
    );
}
