// Ayarlar > Kullanım Limitleri (ailenin kendi Firebase hesabının günlük sınırı)
(function () {
  if (!window.Kullanim) return;
  Kullanim.baslat({
    uygulama: 'aile-ajandasi', bulut: true, ai: false, sinif: 'card pad',
    dil: function () { try { return S.settings.lang; } catch (e) { return document.documentElement.lang; } },
    proje: function () { try { return S.sync.enabled ? S.sync.projectId : ''; } catch (e) { return ''; } },
    linkAc: function (u) { try { if (N.openUrl) return N.openUrl(u); } catch (e) {} window.open(u, '_blank'); }
  });
  Kullanim.yerlestir(function () {
    var h = Array.prototype.find.call(document.querySelectorAll('section.card h4'), function (e) { return e.textContent.indexOf(t('ct_title')) >= 0; });
    return h ? h.closest('section') : null;
  }, true);
})();
