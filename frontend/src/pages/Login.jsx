import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../hooks/useToast';
import { authAPI } from '../api';
import { Lock } from 'lucide-react';

export default function Login() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const { addToast } = useToast();
    const navigate = useNavigate();

    const handleLogin = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            const res = await authAPI.login(username, password);
            localStorage.setItem('token', res.data.access_token);

            if (res.data.must_change_password) {
                addToast('Please change your temporary password', 'warning');
                navigate('/change-password', { replace: true });
            } else {
                addToast('Welcome back!', 'success');
                navigate('/', { replace: true });
            }
        } catch (err) {
            addToast(err?.response?.data?.detail || 'Invalid credentials', 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-base)' }}>
            <div className="surface" style={{ padding: '2.5rem', width: '100%', maxWidth: '400px', textAlign: 'center' }}>
                <div style={{ display: 'inline-flex', padding: '1rem', background: 'var(--bg-elevated)', borderRadius: '50%', marginBottom: '1.5rem', border: '1px solid var(--border)' }}>
                    <Lock size={32} color="var(--accent)" />
                </div>
                <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>StockPro Login</h1>
                <p style={{ color: 'var(--text-muted)', marginBottom: '2rem', fontSize: '0.9rem' }}>Enter your credentials to access the system</p>

                <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', textAlign: 'left' }}>
                    <div className="form-group">
                        <label className="form-label">Username</label>
                        <input
                            required
                            autoFocus
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="e.g. admin"
                            autoComplete="username"
                        />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Password</label>
                        <input
                            type="password"
                            required
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                            autoComplete="current-password"
                        />
                    </div>
                    <button type="submit" className="btn btn-primary" style={{ marginTop: '0.5rem', width: '100%', justifyContent: 'center' }} disabled={loading}>
                        {loading ? 'Authenticating...' : 'Sign In'}
                    </button>
                </form>
            </div>
        </div>
    );
}
