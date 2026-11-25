(function () {
  "use strict";

  const CFG = window.FI_CONFIG || {};
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const state = {
    client: null,
    session: null,
    view: "posts",
    posts: [],
    comments: [],
    loading: false
  };

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("show"), 2600);
  }

  function formatDate(value) {
    if (!value) return "—";
    return new Date(value).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function truncate(value, max) {
    const text = String(value || "");
    return text.length > max ? text.slice(0, max - 1) + "…" : text;
  }

  function setLoginError(message) {
    const error = $("#loginError");
    error.textContent = message || "";
    error.hidden = !message;
  }

  function showLogin(accessMessage) {
    $("#adminView").hidden = true;
    $("#loginView").hidden = false;
    setLoginError(accessMessage || "");
  }

  function showAdmin() {
    $("#loginView").hidden = true;
    $("#adminView").hidden = false;
    $("#adminIdentity").textContent = state.session?.user?.email || "管理员";
  }

  async function verifyAdmin() {
    const result = await state.client.rpc("is_admin");
    if (result.error) throw new Error(`权限检查失败：${result.error.message}`);
    return result.data === true;
  }

  async function startSession(session) {
    state.session = session || null;
    if (!state.session) {
      showLogin();
      return false;
    }
    const isAdmin = await verifyAdmin();
    if (!isAdmin) {
      const userId = state.session.user?.id || "";
      showLogin(`当前账号不是管理员。请让项目所有者将此用户加入 admin_users。\n用户 ID：${userId}`);
      return false;
    }
    showAdmin();
    await loadData();
    return true;
  }

  async function loadData() {
    if (state.loading) return;
    state.loading = true;
    $("#loading").hidden = false;
    $("#tableWrap").hidden = true;
    $("#emptyState").hidden = true;
    try {
      const [postsResult, commentsResult] = await Promise.all([
        state.client.from("posts").select("*").order("created_at", { ascending: false }),
        state.client.from("comments").select("*").order("created_at", { ascending: false })
      ]);
      if (postsResult.error) throw postsResult.error;
      if (commentsResult.error) throw commentsResult.error;
      state.posts = postsResult.data || [];
      state.comments = commentsResult.data || [];
      render();
    } catch (error) {
      $("#loading").textContent = error.message || "无法读取社区内容";
      showToast("读取失败，请检查管理员权限");
    } finally {
      state.loading = false;
    }
  }

  function updateStats() {
    $("#statPosts").textContent = state.posts.length;
    $("#statPublished").textContent = state.posts.filter(item => item.status === "published").length;
    $("#statHidden").textContent = state.posts.filter(item => item.status === "hidden").length;
    $("#statComments").textContent = state.comments.length;
  }

  function currentRows() {
    const query = $("#searchInput").value.trim().toLowerCase();
    const status = $("#statusFilter").value;
    const rows = state.view === "posts" ? state.posts : state.comments;
    return rows.filter(row => {
      if (status && row.status !== status) return false;
      if (!query) return true;
      return [row.title, row.body, row.author_name, row.community]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  }

  function postTitle(postId) {
    return state.posts.find(post => post.id === postId)?.title || "已删除帖子";
  }

  function render() {
    updateStats();
    document.querySelectorAll(".tab").forEach(tab => {
      tab.classList.toggle("active", tab.dataset.view === state.view);
    });
    const rows = currentRows();
    $("#loading").hidden = true;
    $("#tableWrap").hidden = rows.length === 0;
    $("#emptyState").hidden = rows.length !== 0;
    if (!rows.length) return;

    $("#contentRows").innerHTML = rows.map(item => {
      const isPost = state.view === "posts";
      const title = isPost ? item.title : truncate(item.body, 150);
      const context = isPost
        ? `${esc(item.community)} · ${state.comments.filter(comment => comment.post_id === item.id).length} 条评论`
        : `评论于：${esc(postTitle(item.post_id))}`;
      const status = item.status || "published";
      const toggleLabel = status === "published" ? "隐藏" : "恢复";
      const toggleClass = status === "published" ? "danger" : "success";
      const openLink = isPost
        ? `<a class="btn secondary small" href="https://lllaf.com/#/post/${encodeURIComponent(item.id)}" target="_blank" rel="noopener">查看</a>`
        : "";
      return `<tr>
        <td class="title-cell"><b>${esc(title)}</b><small>${context}</small></td>
        <td>u/${esc(item.author_name || "member")}<span class="meta">${esc(item.product_id || "")}</span></td>
        <td><span class="status ${esc(status)}">${esc(status)}</span></td>
        <td>${esc(formatDate(item.created_at))}</td>
        <td><div class="actions">${openLink}<button class="btn ${toggleClass} small" data-moderate="${esc(item.id)}" data-next="${status === "published" ? "hidden" : "published"}">${toggleLabel}</button></div></td>
      </tr>`;
    }).join("");
  }

  async function moderate(id, nextStatus) {
    const table = state.view === "posts" ? "posts" : "comments";
    const items = table === "posts" ? state.posts : state.comments;
    const item = items.find(row => row.id === id);
    if (!item) return;
    const action = nextStatus === "hidden" ? "隐藏" : "恢复";
    if (!window.confirm(`确认${action}这条内容？`)) return;
    const { error } = await state.client.from(table).update({ status: nextStatus }).eq("id", id);
    if (error) {
      showToast(`操作失败：${error.message}`);
      return;
    }
    item.status = nextStatus;
    render();
    showToast(`已${action}`);
  }

  function bindEvents() {
    $("#loginForm").addEventListener("submit", async event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      setLoginError();
      $("#loginButton").disabled = true;
      $("#loginButton").textContent = "正在登录…";
      try {
        const { data, error } = await state.client.auth.signInWithPassword({
          email: String(form.get("email") || "").trim(),
          password: String(form.get("password") || "")
        });
        if (error) throw error;
        const ok = await startSession(data.session);
        if (!ok) return;
        event.currentTarget.reset();
      } catch (error) {
        setLoginError(error.message || "登录失败");
      } finally {
        $("#loginButton").disabled = false;
        $("#loginButton").textContent = "登录后台";
      }
    });

    $("#logoutButton").addEventListener("click", async () => {
      await state.client.auth.signOut();
      state.session = null;
      state.posts = [];
      state.comments = [];
      showLogin();
    });

    document.querySelectorAll(".tab").forEach(tab => {
      tab.addEventListener("click", () => {
        state.view = tab.dataset.view;
        render();
      });
    });
    $("#searchInput").addEventListener("input", render);
    $("#statusFilter").addEventListener("change", render);
    $("#refreshButton").addEventListener("click", loadData);
    $("#contentRows").addEventListener("click", event => {
      const button = event.target.closest("[data-moderate]");
      if (!button) return;
      moderate(button.dataset.moderate, button.dataset.next);
    });
  }

  async function boot() {
    if (!CFG.supabaseUrl || !CFG.supabaseAnonKey || !window.supabase) {
      showLogin("Supabase 配置未加载，请刷新页面或检查 config.js。");
      return;
    }
    state.client = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);
    bindEvents();
    try {
      const { data, error } = await state.client.auth.getSession();
      if (error) throw error;
      await startSession(data.session);
    } catch (error) {
      showLogin(error.message || "后台初始化失败");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
