const API = {
  token: localStorage.getItem('ofertaslab_token'),

  async request(url, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    try {
      const response = await fetch(`/api${url}`, { ...options, headers });
      if (response.status === 401) { this.logout(); return null; }
      if (response.headers.get('content-type')?.includes('text/csv')) {
        return await response.blob();
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Erro na requisição');
      return data;
    } catch (err) {
      if (err.message !== 'Failed to fetch') Toast.error(err.message);
      return null;
    }
  },

  get(url) { return this.request(url); },
  post(url, body) { return this.request(url, { method: 'POST', body: JSON.stringify(body) }); },
  put(url, body) { return this.request(url, { method: 'PUT', body: JSON.stringify(body) }); },
  delete(url) { return this.request(url, { method: 'DELETE' }); },

  setToken(token) {
    this.token = token;
    localStorage.setItem('ofertaslab_token', token);
  },

  logout() {
    this.token = null;
    localStorage.removeItem('ofertaslab_token');
    window.location.href = '/login';
  },

  checkAuth() {
    if (!this.token && !window.location.pathname.includes('/login') && !window.location.pathname.includes('/ofertas-publicas')) {
      window.location.href = '/login';
      return false;
    }
    return true;
  }
};

const Toast = {
  container: null,
  init() {
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.className = 'toast-container';
      document.body.appendChild(this.container);
    }
  },
  show(message, type = 'info') {
    this.init();
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    this.container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  },
  success(msg) { this.show(msg, 'success'); },
  error(msg) { this.show(msg, 'error'); },
  info(msg) { this.show(msg, 'info'); }
};

const Utils = {
  formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
  },
  formatNumber(value) {
    return new Intl.NumberFormat('pt-BR').format(value || 0);
  },
  formatDate(date) {
    if (!date) return '-';
    return new Date(date).toLocaleDateString('pt-BR');
  },
  formatDateTime(date) {
    if (!date) return '-';
    return new Date(date).toLocaleString('pt-BR');
  },
  timeAgo(date) {
    if (!date) return '-';
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);
    if (seconds < 60) return 'agora';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}min atras`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h atras`;
    return `${Math.floor(seconds / 86400)}d atras`;
  },
  debounce(fn, delay = 300) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
  }
};

function initSidebar() {
  const sidebar = document.getElementById('sidebar');
  const toggle = document.querySelector('.sidebar-toggle');
  if (!sidebar) return;

  const currentPage = window.location.pathname;
  document.querySelectorAll('.nav-item').forEach(item => {
    const href = item.getAttribute('href');
    if (href === currentPage || (currentPage === '/' && href === '/')) {
      item.classList.add('active');
    }
  });

  if (toggle) {
    toggle.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      document.querySelector('.main-content')?.classList.toggle('sidebar-collapsed');
      localStorage.setItem('sidebar_collapsed', sidebar.classList.contains('collapsed'));
    });
    if (localStorage.getItem('sidebar_collapsed') === 'true') {
      sidebar.classList.add('collapsed');
      document.querySelector('.main-content')?.classList.add('sidebar-collapsed');
    }
  }
}

function initModal() {
  document.querySelectorAll('[data-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modal = document.getElementById(btn.dataset.modal);
      if (modal) modal.classList.add('active');
    });
  });
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('.modal-overlay')?.classList.remove('active');
    });
  });
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('active');
    });
  });
}

function closeModal(id) {
  document.getElementById(id)?.classList.remove('active');
}

function showLoading(container) {
  container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
}

function showEmpty(container, message) {
  container.innerHTML = '<div class="empty-state"><div class="icon">📭</div><h3>' + (message || 'Nenhum dado encontrado') + '</h3></div>';
}

document.addEventListener('DOMContentLoaded', () => {
  if (!window.location.pathname.includes('/login')) {
    if (!API.checkAuth()) return;
  }
  initSidebar();
  initModal();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
});
