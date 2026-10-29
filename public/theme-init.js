// Runs in <head> before first paint so the saved theme doesn't flash.
try { var t = localStorage.getItem('pmo-hub-theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) { /* ignore */ }
