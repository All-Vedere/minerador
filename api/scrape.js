export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, url, page, category_id } = req.query;

  const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/html, */*',
    'Accept-Language': 'pt-BR,pt;q=0.9',
  };

  function getBase(url) {
    try { const u = new URL(url); return `${u.protocol}//${u.host}`; } catch { return url; }
  }

  try {
    // ─── GET CATEGORIES ───
    if (action === 'categories') {
      const base = getBase(url);

      // Try WooCommerce Store API first (works on most WooCommerce sites)
      try {
        const apiResp = await fetch(`${base}/wp-json/wc/store/v1/products/categories?per_page=50&hide_empty=true`, { headers: HEADERS });
        if (apiResp.ok) {
          const cats = await apiResp.json();
          if (Array.isArray(cats) && cats.length > 0) {
            const categories = cats
              .filter(c => c.parent === 0) // main categories only
              .map(c => ({ id: c.id, name: c.name, url: c.link || `${base}/categoria/${c.slug}/`, slug: c.slug, count: c.count }))
              .filter(c => c.count > 0)
              .sort((a,b) => b.count - a.count);
            return res.status(200).json({ categories, source: 'woocommerce_api' });
          }
        }
      } catch {}

      // Try WooCommerce v2 API
      try {
        const apiResp = await fetch(`${base}/wp-json/wp/v2/product_cat?per_page=50&hide_empty=true`, { headers: HEADERS });
        if (apiResp.ok) {
          const cats = await apiResp.json();
          if (Array.isArray(cats) && cats.length > 0) {
            const categories = cats
              .filter(c => c.parent === 0)
              .map(c => ({ id: c.id, name: c.name, url: c.link, slug: c.slug, count: c.count }))
              .filter(c => c.count > 0);
            return res.status(200).json({ categories, source: 'wp_api' });
          }
        }
      } catch {}

      // Fallback: scrape HTML navigation
      const htmlResp = await fetch(base, { headers: { ...HEADERS, 'Accept': 'text/html' } });
      const html = await htmlResp.text();
      const categories = [];
      const seen = new Set();
      const pat = /href="(https?:\/\/[^"]*\/categoria\/([^/"]+)\/)"/g;
      let m;
      while ((m = pat.exec(html)) !== null) {
        const catUrl = m[1];
        const slug = m[2];
        if (!seen.has(slug) && !catUrl.includes('/categoria/' + slug + '/')) {
          // skip subcategories
        }
        if (!seen.has(slug)) {
          seen.add(slug);
          const isSubcat = (catUrl.match(/\/categoria\//g)||[]).length === 1 && catUrl.split('/categoria/')[1].includes('/');
          if (!isSubcat) {
            categories.push({ url: catUrl, name: formatSlug(slug), slug, id: null });
          }
        }
      }
      return res.status(200).json({ categories, source: 'html_scrape' });
    }

    // ─── GET PRODUCTS ───
    if (action === 'products') {
      const pageNum = parseInt(page) || 1;
      const base = getBase(url);

      // Try WooCommerce Store API with category ID
      if (category_id) {
        try {
          const apiUrl = `${base}/wp-json/wc/store/v1/products?per_page=100&page=${pageNum}&category=${category_id}&orderby=popularity`;
          const apiResp = await fetch(apiUrl, { headers: HEADERS });
          if (apiResp.ok) {
            const data = await apiResp.json();
            if (Array.isArray(data) && data.length > 0) {
              const products = data.map(p => ({
                name: p.name,
                url: p.permalink,
                image: p.images?.[0]?.src || null,
                price: p.prices?.price ? (parseInt(p.prices.price) / 100).toFixed(2) : null,
                id: p.id
              }));
              const totalPages = parseInt(apiResp.headers.get('X-WP-TotalPages') || '1');
              return res.status(200).json({ products, hasNextPage: pageNum < totalPages, pageNum, source: 'woocommerce_api' });
            }
          }
        } catch {}
      }

      // Try WooCommerce Store API with category URL slug
      try {
        const slug = url.split('/categoria/')[1]?.replace(/\//g,'') || '';
        // First get category ID from slug
        const catResp = await fetch(`${base}/wp-json/wc/store/v1/products/categories?slug=${slug}`, { headers: HEADERS });
        if (catResp.ok) {
          const cats = await catResp.json();
          if (Array.isArray(cats) && cats.length > 0) {
            const catId = cats[0].id;
            const apiUrl = `${base}/wp-json/wc/store/v1/products?per_page=100&page=${pageNum}&category=${catId}&orderby=popularity`;
            const apiResp = await fetch(apiUrl, { headers: HEADERS });
            if (apiResp.ok) {
              const data = await apiResp.json();
              if (Array.isArray(data) && data.length > 0) {
                const products = data.map(p => ({
                  name: p.name,
                  url: p.permalink,
                  image: p.images?.[0]?.src || null,
                  price: p.prices?.price ? (parseInt(p.prices.price) / 100).toFixed(2) : null,
                  id: p.id
                }));
                const totalPages = parseInt(apiResp.headers.get('X-WP-TotalPages') || '1');
                return res.status(200).json({ products, hasNextPage: pageNum < totalPages, pageNum, source: 'woocommerce_api' });
              }
            }
          }
        }
      } catch {}

      // Fallback: try sitemap or search
      try {
        const slug = url.split('/categoria/')[1]?.replace(/\//g,'') || '';
        const sitemapUrl = `${base}/wp-sitemap-taxonomies-product_cat-1.xml`;
        // Try product sitemap
        const siteResp = await fetch(`${base}/product-sitemap.xml`, { headers: HEADERS });
        if (siteResp.ok) {
          const xml = await siteResp.text();
          const urlPat = /<loc>(https?:\/\/[^<]+)<\/loc>/g;
          const products = [];
          let m;
          while ((m = urlPat.exec(xml)) !== null && products.length < 50) {
            products.push({ name: m[1].split('/').filter(Boolean).pop()?.replace(/-/g,' ') || 'Produto', url: m[1], image: null, price: null });
          }
          if (products.length > 0) return res.status(200).json({ products, hasNextPage: false, source: 'sitemap' });
        }
      } catch {}

      return res.status(200).json({ products: [], hasNextPage: false, source: 'none', error: 'Could not fetch products' });
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

function formatSlug(slug) {
  return slug.replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase()).trim();
}
