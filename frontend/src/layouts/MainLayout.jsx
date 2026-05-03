import { Outlet } from 'react-router-dom';
import { useState } from 'react';
import Navbar from '../components/Navbar';
import Sidebar from '../components/Sidebar';
import Toast from '../components/Toast';
import KbdHint from '../components/KbdHint';

const globalHints = [
    { key: 'Alt+1-5', label: 'Navigate' },
    { key: 'Alt+N', label: 'New' },
    { key: 'Alt+S', label: 'Search' },
    { key: 'Esc', label: 'Close' },
    { key: 'Enter', label: 'Confirm' },
];

export default function MainLayout() {
    const [searchQuery, setSearchQuery] = useState('');

    return (
        <div className="app-shell" style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
            {/* Main row: Sidebar + content */}
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                <Sidebar />

                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
                    <Navbar onSearch={setSearchQuery} />

                    <main style={{
                        flex: 1,
                        overflowY: 'auto',
                        overflowX: 'hidden',
                        padding: '1.25rem 1.25rem 1.25rem',
                        background: 'var(--canvas)',
                    }} className="scrollbar">
                        <Outlet context={{ searchQuery }} />
                    </main>
                </div>
            </div>

            {/* Full-width keyboard hint bar — sits below everything, never overlaps */}
            <KbdHint hints={globalHints} />

            <Toast />
        </div>
    );
}
