import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../hooks/useToast';
import { authAPI } from '../api';
import { ShieldAlert, Eye, EyeOff, Loader2 } from 'lucide-react';

function PasswordInput({ label, value, onChange, autoFocus }) {
    const [show, setShow] = useState(false);
    return (
        <div className="form-group">
            <label className="form-label">{label}</label>
            <div style={{ position: 'relative' }}>
                <input
                    type={show ? 'text' : 'password'}
                    required
                    autoFocus={autoFocus}
                    value={value}
                    onChange={onChange}
                    style={{ width: '100%', paddingRight: '2.8rem', boxSizing: 'border-box' }}
                />
                <button
                    type="button"
                    onClick={() => setShow(s => !s)}
                    style={{
                        position: 'absolute', right: '0.75rem', top: '50%',
                        transform: 'translateY(-50%)', background: 'none', border: 'none',
                        cursor: 'pointer', color: 'var(--text-muted)', padding: 0, display: 'flex'
                    }}
                    tabIndex={-1}
                    aria-label={show ? 'Hide password' : 'Show password'}
                >
                    {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
            </div>
        </div>
    );
}

export default function ChangePassword() {
    const [oldPassword, setOldPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const { addToast } = useToast();
    const navigate = useNavigate();

    const handleUpdate = async (e) => {
        e.preventDefault();
        setErrorMsg('');

        if (newPassword !== confirmPassword) {
            setErrorMsg('New passwords do not match. Please re-enter.');
            return;
        }
        if (newPassword.length < 6) {
            setErrorMsg('New password must be at least 6 characters long.');
            return;
        }
        if (oldPassword === newPassword) {
            setErrorMsg('New password cannot be the same as the current password.');
            return;
        }

        setLoading(true);
        try {
            await authAPI.changePassword(oldPassword, newPassword);
            addToast('Password updated! Please log in with your new password.', 'success');
            localStorage.removeItem('token');
            navigate('/login', { replace: true });
        } catch (err) {
            console.error('[ChangePassword] Error:', err);
            const status = err?.response?.status;
            const detail = err?.response?.data?.detail;

            if (status === 401) {
                setErrorMsg('Session expired. Please log out and log back in.');
            } else if (status === 400 && detail) {
                setErrorMsg(detail);
            } else if (!err?.response) {
                setErrorMsg('Cannot reach the server. Please check if the backend is running.');
            } else {
                setErrorMsg(detail || 'Something went wrong. Please try again.');
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-base)' }}>
            <div className="surface" style={{ padding: '2.5rem', width: '100%', maxWidth: '420px', textAlign: 'center' }}>
                <div style={{ display: 'inline-flex', padding: '1rem', background: 'var(--bg-elevated)', borderRadius: '50%', marginBottom: '1.5rem', border: '1px solid var(--danger)' }}>
                    <ShieldAlert size={32} color="var(--danger)" />
                </div>
                <h1 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: '0.5rem', color: 'var(--danger)' }}>Action Required</h1>
                <p style={{ color: 'var(--text-muted)', marginBottom: '2rem', fontSize: '0.9rem', lineHeight: 1.6 }}>
                    You are logged in with a temporary password. Please set a new secure password to continue.
                </p>

                {errorMsg && (
                    <div style={{
                        background: 'rgba(var(--danger-rgb, 220,50,50), 0.1)',
                        border: '1px solid var(--danger)',
                        borderRadius: '8px',
                        padding: '0.75rem 1rem',
                        marginBottom: '1.25rem',
                        color: 'var(--danger)',
                        fontSize: '0.875rem',
                        textAlign: 'left',
                        lineHeight: 1.5
                    }}>
                        ⚠️ {errorMsg}
                    </div>
                )}

                <form onSubmit={handleUpdate} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', textAlign: 'left' }}>
                    <PasswordInput
                        label="Current Password"
                        value={oldPassword}
                        onChange={(e) => setOldPassword(e.target.value)}
                        autoFocus
                    />
                    <PasswordInput
                        label="New Password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                    />
                    <PasswordInput
                        label="Confirm New Password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                    />

                    <button
                        type="submit"
                        className="btn btn-primary"
                        style={{ marginTop: '0.5rem', width: '100%', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                        disabled={loading}
                    >
                        {loading ? (
                            <>
                                <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                                Updating…
                            </>
                        ) : 'Update Password'}
                    </button>

                    <button
                        type="button"
                        onClick={() => { localStorage.removeItem('token'); navigate('/login', { replace: true }); }}
                        className="btn btn-ghost"
                        style={{ width: '100%', justifyContent: 'center' }}
                    >
                        Cancel &amp; Logout
                    </button>
                </form>
            </div>
        </div>
    );
}
