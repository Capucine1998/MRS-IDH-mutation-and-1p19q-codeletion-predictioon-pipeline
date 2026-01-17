// utils.js
function sanitizePath(path) {
    const basePath = "/home/mouette/website/www/html/";
    return path.replace(basePath, '');
}

// Theme handling (light/dark) + small UI helpers
const THEME_STORAGE_KEY = 'idhmrs_theme';

function getSystemTheme() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getSavedTheme() {
    try {
        return localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
        return null;
    }
}

function setSavedTheme(theme) {
    try {
        localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
        // ignore
    }
}

function applyTheme(theme) {
    const t = (theme === 'dark' || theme === 'light') ? theme : getSystemTheme();
    document.documentElement.setAttribute('data-theme', t);
    // Let Bootstrap components adapt too.
    document.documentElement.setAttribute('data-bs-theme', t);

    const btn = document.getElementById('themeToggle');
    if (btn) {
        const isDark = t === 'dark';
        btn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
        btn.setAttribute('title', isDark ? 'Light mode' : 'Dark mode');
        btn.innerHTML = isDark
            ? '<i class="bi bi-sun-fill"></i><span class="d-none d-sm-inline ms-2">Light</span>'
            : '<i class="bi bi-moon-stars-fill"></i><span class="d-none d-sm-inline ms-2">Dark</span>';
    }
}

function initTheme() {
    const saved = getSavedTheme();
    applyTheme(saved || getSystemTheme());

    // If user didn't explicitly choose, follow OS changes.
    if (!saved && window.matchMedia) {
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const handler = () => applyTheme(getSystemTheme());
        try {
            mq.addEventListener('change', handler);
        } catch {
            // Safari
            mq.addListener(handler);
        }
    }

    const btn = document.getElementById('themeToggle');
    if (btn) {
        btn.addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-theme') || getSystemTheme();
            const next = current === 'dark' ? 'light' : 'dark';
            setSavedTheme(next);
            applyTheme(next);
        });
    }
}

function initAOS() {
    if (window.AOS && typeof window.AOS.init === 'function') {
        window.AOS.init({
            duration: 650,
            easing: 'ease-out-cubic',
            once: true,
            offset: 60,
        });
    }
}

function initQuickstartHover() {
    const items = document.querySelectorAll('[data-feature]');
    const cards = document.querySelectorAll('.feature-card[data-feature]');
    if (!items.length || !cards.length) {
        return;
    }

    const cardMap = new Map();
    cards.forEach(card => {
        const key = card.getAttribute('data-feature');
        if (key) {
            cardMap.set(key, card);
        }
    });

    const clearActive = () => {
        cardMap.forEach(card => card.classList.remove('is-active'));
    };

    items.forEach(item => {
        item.addEventListener('mouseenter', () => {
            const key = item.getAttribute('data-feature');
            clearActive();
            const card = key ? cardMap.get(key) : null;
            if (card) {
                card.classList.add('is-active');
            }
        });
        item.addEventListener('mouseleave', () => {
            clearActive();
        });
        item.addEventListener('focus', () => {
            const key = item.getAttribute('data-feature');
            clearActive();
            const card = key ? cardMap.get(key) : null;
            if (card) {
                card.classList.add('is-active');
            }
        });
        item.addEventListener('blur', clearActive);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initAOS();
    initQuickstartHover();
});