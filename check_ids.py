import re

with open('app.js', 'r', encoding='utf-8') as f:
    app_js = f.read()

with open('index.html', 'r', encoding='utf-8') as f:
    index_html = f.read()

get_ids = set(re.findall(r'document\.getElementById\(["\']([^"\']+)["\']\)', app_js))
html_ids = set(re.findall(r'id=["\']([^"\']+)["\']', index_html))

missing_in_html = get_ids - html_ids
print(f"Total IDs referenced in app.js: {len(get_ids)}")
print(f"Total IDs defined in index.html: {len(html_ids)}")
print(f"IDs referenced in app.js but MISSING in index.html ({len(missing_in_html)}):")
for m in sorted(missing_in_html):
    print(f"  - {m}")
