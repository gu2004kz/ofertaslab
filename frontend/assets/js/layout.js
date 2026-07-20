function renderLayout(activePage) {
  const pages = [
    { href: '/', icon: '📊', label: 'Dashboard', section: 'Principal' },
    { href: '/ofertas', icon: '🏷️', label: 'Ofertas', section: 'Principal' },
    { href: '/telegram', icon: '📱', label: 'Telegram', section: 'Principal' },
    { href: '/whatsapp', icon: '💬', label: 'WhatsApp', section: 'Principal' },
    { href: '/afiliados', icon: '🔗', label: 'Afiliados', section: 'Principal' },
    { href: '/analytics', icon: '📈', label: 'Analytics', section: 'Dados' },
    { href: '/configuracoes', icon: '⚙️', label: 'Configurações', section: 'Dados' },
    { href: '/ofertas-publicas', icon: '🌐', label: 'Loja Pública', section: 'Externo' },
  ];

  let navHtml = '';
  let lastSection = '';
  pages.forEach(p => {
    if (p.section !== lastSection) {
      navHtml += '<div class="nav-section-title">' + p.section + '</div>';
      lastSection = p.section;
    }
    const active = p.href === activePage ? ' active' : '';
    navHtml += '<a href="' + p.href + '" class="nav-item' + active + '"><span class="nav-icon">' + p.icon + '</span><span class="nav-text">' + p.label + '</span></a>';
  });

  const sidebar = document.getElementById('sidebar');
  if (sidebar) {
    sidebar.querySelector('.sidebar-nav').innerHTML = '<div class="nav-section">' + navHtml + '</div>';
  }
}
