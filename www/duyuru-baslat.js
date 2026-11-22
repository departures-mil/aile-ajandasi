// Admin duyuruları (https://github.com/departures-mil/duyurular)
Duyuru.baslat({
  uygulama: 'aile-ajandasi',
  surum: '5.3',
  dil: function () { try { return S.settings.lang; } catch (e) { return document.documentElement.lang; } }
});
