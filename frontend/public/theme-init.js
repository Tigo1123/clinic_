(function() {
        try {
          var t = localStorage.getItem('alshifa_theme') || localStorage.getItem('cms_theme');
          if (!t && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) t = 'dark';
          if (t) {
            document.documentElement.setAttribute('data-theme', t);
            document.documentElement.style.colorScheme = t;
          }
        } catch (e) {}
      })();

