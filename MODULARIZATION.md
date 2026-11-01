# Münazara Yönetim Sistemi — Modüler yapı

Bu dal, 3.36 sürümündeki uygulamanın dosya yapısını davranış değişikliği hedeflemeden ayırır.

## Dosyalar
- `index.html`: uygulama kabuğu, Firebase SDK yüklemeleri ve yapılandırması.
- `css/app.css`: mevcut stil kuralları.
- `js/fixture-data.js`: gömülü fikstür HTML verisinin mevcut Base64 içeriği.
- `js/00-core.js`: ortak sabitler, durum değişkenleri, yardımcılar, Firebase/çevrimdışı kuyruk ve oturum altyapısı.
- `js/10-scoring.js`: jüri seçimi, puanlama, ortak süre ve puan gönderimi.
- `js/20-reports.js`: raporlama ve dışa aktarma.
- `js/30-admin.js`: yönetici paneli, maç yönetimi, işlem günlükleri ve veri kurtarma.
- `js/40-students.js`: öğrenci, okul ve Excel/CSV işlemleri.
- `js/50-tournament.js`: Firebase tabanlı turnuva ağacı.
- `js/60-fixture-admin.js`: gömülü fikstür/turnuva yönetim ekranı.
- `js/70-bootstrap.js`: uygulama başlangıcı ve global olay dinleyicileri.

## Yükleme sırası
Uygulama dosyaları normal (classic) script olarak sıralı yüklenir. Bilinçli olarak `type="module"`, `async` veya `defer` kullanılmaz. Arayüz HTML içindeki `onclick` çağrılarını ve dosyalar arası ortak global durum değişkenlerini kullandığı için bu geçiş aşamasında global kapsam korunur.

## Kapsam
Bu refactor Firebase veri yollarını, puan kurallarını, fikstür içeriğini ve mevcut yönetici giriş yöntemini değiştirmez. Gerçek tarayıcı/Firebase uçtan uca testleri ayrıca yapılmalıdır.
