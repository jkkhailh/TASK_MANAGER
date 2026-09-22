import re
import os

js_files = [
    'static/app.js',
    'static/categories.js',
    'static/dashboard.js',
    'static/inventory.js',
    'static/internal-tasks.js',
    'static/brand-menu.js'
]

forbidden_words = ['123.25.239.13', 'PM2026BOPP', 'SQL Server', 'local_maintenance.db', 'NAS Synology']

print("=== VERIFYING JS FILES FOR FORBIDDEN STRINGS ===")
for fpath in js_files:
    with open(fpath, 'r', encoding='utf-8') as f:
        content = f.read()

    found_forbidden = []
    for word in forbidden_words:
        # Ignore comments if any
        matches = [m.start() for m in re.finditer(re.escape(word), content, re.IGNORECASE)]
        if matches:
            found_forbidden.append((word, len(matches)))

    print(f"File: {fpath} -> Forbidden words: {found_forbidden if found_forbidden else 'None (CLEAN)'}")

print("\n=== ALL JS CHECKS FINISHED ===")
