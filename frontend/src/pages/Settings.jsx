import { useEffect, useState, useCallback } from 'react';
import { Settings, Save, Building2, Phone, Globe, FileText, Tag } from 'lucide-react';
import { getBusinessSettings, updateBusinessSettings } from '../api';
import { useToast } from '../hooks/useToast';

const empty = {
    company_name: '',
    tagline: '',
    address: '',
    city: '',
    state: '',
    pincode: '',
    phone: '',
    email: '',
    website: '',
    gst_number: '',
    state_code: '',
    pan_number: '',
    invoice_prefix: 'INV',
    invoice_footer: '',
    logo_url: '',
};

export default function SettingsPage() {
    const { addToast } = useToast();
    const [form, setForm] = useState(empty);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        try {
            const res = await getBusinessSettings();
            setForm({ ...empty, ...res.data });
        } catch {
            addToast('Failed to load settings', 'error');
        } finally {
            setLoading(false);
        }
    }, [addToast]);

    useEffect(() => { load(); }, [load]);

    const save = async () => {
        if (!form.company_name?.trim()) return addToast('Company name is required', 'error');
        setSaving(true);
        try {
            await updateBusinessSettings(form);
            addToast('Settings saved successfully!', 'success');
        } catch {
            addToast('Failed to save settings', 'error');
        } finally {
            setSaving(false);
        }
    };

    const field = (label, key, placeholder = '', opts = {}) => (
        <div className="form-group">
            <label className="form-label">{label}</label>
            {opts.textarea ? (
                <textarea
                    rows={3}
                    value={form[key] || ''}
                    placeholder={placeholder}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                    style={{ resize: 'vertical', fontFamily: 'inherit' }}
                />
            ) : (
                <input
                    type={opts.type || 'text'}
                    value={form[key] || ''}
                    placeholder={placeholder}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                />
            )}
        </div>
    );

    if (loading) return (
        <div style={{ padding: '2rem' }}>
            {[...Array(6)].map((_, i) => <div key={i} className="skeleton" style={{ height: 48, marginBottom: 12 }} />)}
        </div>
    );

    return (
        <>
            <div className="page-header">
                <h2 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Settings size={20} /> Invoice Settings
                </h2>
                <button className="btn btn-primary" onClick={save} disabled={saving}>
                    <Save size={15} /> {saving ? 'Saving…' : 'Save Settings'}
                </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', maxWidth: 960 }}>

                {/* ─── Company Info ──────────────────────────────────── */}
                <div className="surface" style={{ gridColumn: '1 / -1' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', color: 'var(--text-secondary)', fontWeight: 600, fontSize: '0.85rem' }}>
                        <Building2 size={16} /> Company Information
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                        {field('Company Name *', 'company_name', 'e.g. Sharma Medical Stores')}
                        {field('Tagline / Slogan', 'tagline', 'e.g. Trusted since 1998')}
                    </div>
                    {field('Address', 'address', 'Full street address…', { textarea: true })}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
                        {field('City', 'city', 'e.g. Pune')}
                        {field('State', 'state', 'e.g. Maharashtra')}
                        {field('PIN Code', 'pincode', 'e.g. 411001')}
                    </div>
                </div>

                {/* ─── Contact ───────────────────────────────────────── */}
                <div className="surface">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', color: 'var(--text-secondary)', fontWeight: 600, fontSize: '0.85rem' }}>
                        <Phone size={16} /> Contact Details
                    </div>
                    {field('Phone', 'phone', '+91 98765 43210')}
                    {field('Email', 'email', 'store@example.com', { type: 'email' })}
                    {field('Website', 'website', 'https://example.com')}
                </div>

                {/* ─── Tax / GST ─────────────────────────────────────── */}
                <div className="surface">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', color: 'var(--text-secondary)', fontWeight: 600, fontSize: '0.85rem' }}>
                        <Tag size={16} /> Tax &amp; Compliance
                    </div>
                    {field('GST Number', 'gst_number', 'e.g. 27AAAAA0000A1Z5')}
                    {field('State Code', 'state_code', 'e.g. 27 (Maharashtra)')}
                    {field('PAN Number', 'pan_number', 'e.g. AAAAA0000A')}
                </div>

                {/* ─── Invoice Config ────────────────────────────────── */}
                <div className="surface" style={{ gridColumn: '1 / -1' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', color: 'var(--text-secondary)', fontWeight: 600, fontSize: '0.85rem' }}>
                        <FileText size={16} /> Invoice Configuration
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: '0.75rem', alignItems: 'start' }}>
                        <div>
                            {field('Invoice Prefix', 'invoice_prefix', 'e.g. INV')}
                            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                                Final format: <strong>{form.invoice_prefix || 'INV'}/25-26/0001</strong>
                            </p>
                        </div>
                        {field('Invoice Footer Note', 'invoice_footer', 'e.g. Thank you for your business! Goods once sold cannot be returned.', { textarea: true })}
                    </div>
                </div>

            </div>
        </>
    );
}
