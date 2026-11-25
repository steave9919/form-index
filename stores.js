(function () {
  "use strict";

  const CFG = window.FI_CONFIG || {};
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const state = { stores: [], products: [], ratings: [], query: "", session: null, profile: null };
  const client = (CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase)
    ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey)
    : null;

  function formatDate(value) {
    if (!value) return "Not yet checked";
    return new Date(value).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  }

  function hostname(url) {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch (error) { return url || ""; }
  }

  function price(value, currency) {
    if (value == null) return "Price not indexed";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(Number(value));
  }

  function toast(message) {
    const element = $("#toast");
    element.textContent = message;
    element.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => element.classList.remove("show"), 2800);
  }

  function openReview(storeId) {
    if (!state.session) {
      window.location.href = "https://lllaf.com/#/";
      return;
    }
    const store = state.stores.find(item => item.id === storeId);
    if (!store) return;
    $("#reviewStoreId").value = store.id;
    $("#reviewStoreName").textContent = store.name;
    $("#reviewProduct").innerHTML = '<option value="">Store experience</option>' + state.products
      .filter(product => product.store_id === store.id)
      .map(product => `<option value="${esc(product.id)}">${esc(product.name)}</option>`)
      .join("");
    $("#reviewError").hidden = true;
    $("#reviewForm").reset();
    $("#reviewStoreId").value = store.id;
    $("#reviewDialog").showModal();
  }

  function render() {
    const query = state.query.trim().toLowerCase();
    const stores = state.stores.filter(store => {
      if (!query) return true;
      const products = state.products.filter(product => product.store_id === store.id);
      return [store.name, store.slug, store.description, ...products.flatMap(product => [product.name, product.category])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);
    });

    $("#loading").hidden = true;
    $("#storeGrid").innerHTML = stores.map(store => {
      const products = state.products.filter(product => product.store_id === store.id);
      const rating = state.ratings.find(item => item.store_id === store.id) || {};
      const reviewCount = Number(rating.review_count || 0);
      const average = reviewCount ? Number(rating.average_rating).toFixed(1) : null;
      const productLinks = products.slice(0, 4).map(product => `<a class="product-link" href="${esc(product.product_url)}" target="_blank" rel="sponsored noopener"><span>${esc(product.name)}</span><span>${esc(price(product.price_usd, product.currency))} ↗</span></a>`).join("");
      return `<article class="store">
        <div class="store-top">
          <div class="store-avatar">${esc((store.name || "S").charAt(0))}</div>
          <div><h2>${esc(store.name)}</h2><div class="domain">${esc(hostname(store.website_url))}</div></div>
          ${store.catalog_checked_at ? `<span class="verified">Catalog checked</span>` : ""}
        </div>
        <p class="description">${esc(store.description || "Retailer awaiting editorial profile.")}</p>
        <div class="metrics">
          <span class="metric">${products.length} products indexed</span>
          <span class="metric">${average ? `★ ${average} / 5 · ${reviewCount} ratings` : "No public ratings yet"}</span>
          <span class="metric">Checked ${esc(formatDate(store.catalog_checked_at))}</span>
        </div>
        <div class="products"><h3>Indexed products</h3>${productLinks || '<div class="legend">No products indexed yet.</div>'}</div>
        <div class="actions">
          <a class="btn primary" href="${esc(store.website_url)}" target="_blank" rel="sponsored noopener">Visit store ↗</a>
          <a class="btn secondary" href="https://lllaf.com/#/r/stores">Discuss this store</a>
          ${state.session ? `<button class="btn secondary" data-review="${esc(store.id)}">Write a review</button>` : `<a class="btn secondary" href="https://lllaf.com/#/">Log in to review</a>`}
        </div>
      </article>`;
    }).join("");
    $("#empty").hidden = stores.length > 0;
  }

  async function load() {
    if (!client) {
      $("#loading").textContent = "Could not load the retailer directory. Check the site configuration.";
      return;
    }
    try {
      const [storesResult, productsResult, ratingsResult] = await Promise.all([
        client.from("stores").select("*").eq("status", "active").order("name"),
        client.from("store_products").select("*").eq("status", "active").order("price_usd", { ascending: true }),
        client.rpc("get_store_ratings")
      ]);
      if (storesResult.error) throw storesResult.error;
      if (productsResult.error) throw productsResult.error;
      if (ratingsResult.error) throw ratingsResult.error;
      state.stores = storesResult.data || [];
      state.products = productsResult.data || [];
      state.ratings = ratingsResult.data || [];
      const sessionResult = await client.auth.getSession();
      state.session = sessionResult.data?.session || null;
      if (state.session?.user) {
        const profileResult = await client.from("profiles").select("username").eq("id", state.session.user.id).single();
        state.profile = profileResult.data || null;
      }
      $("#storeCount").textContent = state.stores.length;
      $("#productCount").textContent = state.products.length;
      $("#ratingCount").textContent = state.ratings.reduce((sum, item) => sum + Number(item.review_count || 0), 0);
      render();
    } catch (error) {
      $("#loading").textContent = error.message || "Could not load the retailer directory.";
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("#storeSearch").addEventListener("input", event => {
      state.query = event.target.value;
      render();
    });
    $("#storeGrid").addEventListener("click", event => {
      const button = event.target.closest("[data-review]");
      if (button) openReview(button.dataset.review);
    });
    $("#cancelReview").addEventListener("click", () => $("#reviewDialog").close());
    $("#reviewForm").addEventListener("submit", async event => {
      event.preventDefault();
      if (!state.session || !state.profile) {
        $("#reviewError").textContent = "Please log in before submitting a review.";
        $("#reviewError").hidden = false;
        return;
      }
      const form = new FormData(event.currentTarget);
      $("#reviewError").hidden = true;
      $("#submitReview").disabled = true;
      $("#submitReview").textContent = "Submitting…";
      const result = await client.from("store_reviews").insert({
        store_id: form.get("storeId"),
        product_id: form.get("productId") || null,
        user_id: state.session.user.id,
        author_name: state.profile.username,
        rating: Number(form.get("rating")),
        title: String(form.get("title") || "").trim(),
        body: String(form.get("body") || "").trim(),
        status: "pending"
      });
      $("#submitReview").disabled = false;
      $("#submitReview").textContent = "Submit for review";
      if (result.error) {
        $("#reviewError").textContent = result.error.message;
        $("#reviewError").hidden = false;
        return;
      }
      $("#reviewDialog").close();
      toast("Review submitted for moderation");
    });
    load();
  });
})();
