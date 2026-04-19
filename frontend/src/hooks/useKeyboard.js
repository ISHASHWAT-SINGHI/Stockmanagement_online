import { useEffect } from 'react';

/**
 * Register a keyboard shortcut.
 * @param {string} key   - e.g. 'n', 's', '1'
 * @param {function} cb  - callback to invoke
 * @param {{ alt?, ctrl?, shift? }} mods - modifiers (default: alt)
 */
export function useKeyboardShortcut(key, cb, mods = { alt: true }) {
    useEffect(() => {
        const handler = (e) => {
            if (mods.alt && !e.altKey) return;
            if (mods.ctrl && !e.ctrlKey) return;
            if (mods.shift && !e.shiftKey) return;
            if (e.key.toLowerCase() !== key.toLowerCase()) return;
            // Don't fire when typing in an input/textarea/select
            const tag = document.activeElement?.tagName?.toLowerCase();
            if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
            e.preventDefault();
            cb();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [key, cb, mods]);
}
